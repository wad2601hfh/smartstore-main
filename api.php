<?php
// Suppress PHP notices/warnings so they don't break JSON output
error_reporting(0);
@ini_set('display_errors', 0);

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

// Always return JSON even on fatal PHP errors
set_exception_handler(function($e) {
    echo json_encode(['error' => $e->getMessage()]);
    exit;
});

if ($conn->connect_error) { die(json_encode(["error" => "Connection failed: " . $conn->connect_error])); }
$conn->set_charset('utf8mb4');

$action = $_REQUEST['action'] ?? '';

// Auto-clean old data
$conn->query("DELETE FROM requests WHERE created_at < NOW() - INTERVAL 12 HOUR");

if ($action === 'remote_upload') {
    $req_id = (int)$_POST['request_id'];
    if (isset($_FILES['food_image'])) {
        if (!is_dir('uploads')) { mkdir('uploads', 0777, true); }
        move_uploaded_file($_FILES['food_image']['tmp_name'], "uploads/remote_req_{$req_id}.jpg");
        echo json_encode(['status' => 'success']);
    } else {
        echo json_encode(['status' => 'error']);
    }
    exit;
}

if ($action === 'check_remote') {
    $req_id = (int)$_GET['request_id'];
    $path = "uploads/remote_req_{$req_id}.jpg";
    if (file_exists($path)) {
        echo json_encode(['status' => 'found', 'url' => $path . '?v=' . time()]);
    } else {
        echo json_encode(['status' => 'waiting']);
    }
    exit;
}

// --- IDENTITY SYSTEM ---

if ($action === 'upsert_user') {
    $dname = trim($_POST['display_name'] ?? '');
    $role  = $_POST['role'] ?? 'buyer';
    $phone = trim($_POST['phone'] ?? '');
    $bank  = trim($_POST['bank_info'] ?? '');

    if (empty($dname)) { echo json_encode(['error' => 'Name cannot be empty.']); exit; }

    $stmt = $conn->prepare(
        "INSERT INTO users (display_name, role, phone, bank_info, balance, earnings)
         VALUES (?, ?, ?, ?, 0, 0)
         ON DUPLICATE KEY UPDATE
           role      = VALUES(role),
           phone     = VALUES(phone),
           bank_info = VALUES(bank_info)"
    );
    $stmt->bind_param('ssss', $dname, $role, $phone, $bank);
    if ($stmt->execute()) {
        echo json_encode(['status' => 'success']);
    } else {
        echo json_encode(['error' => $conn->error]);
    }
    exit;
}

// --- WALLET ENDPOINTS ---

if ($action === 'get_balance') {
    $uid = $conn->real_escape_string($_GET['user_id'] ?? '');
    $res = $conn->query("SELECT balance, earnings FROM users WHERE display_name='$uid' LIMIT 1");
    $row = $res->fetch_assoc();
    echo json_encode(['balance' => (float)($row['balance'] ?? 0), 'earnings' => (float)($row['earnings'] ?? 0)]);
    exit;
}

if ($action === 'topup') {
    $uid    = $conn->real_escape_string($_POST['user_id'] ?? '');
    $amount = (int)($_POST['amount'] ?? 0);
    $method = $conn->real_escape_string($_POST['method'] ?? 'cash');

    if ($amount < 1000) { echo json_encode(['error' => 'Minimum top up Rp 1.000']); exit; }

    // For demo: auto-credit balance immediately
    $conn->query("UPDATE users SET balance = balance + $amount WHERE display_name = '$uid'");
    $new_balance = 0;
    $r = $conn->query("SELECT balance FROM users WHERE display_name='$uid' LIMIT 1");
    if ($row = $r->fetch_assoc()) $new_balance = (float)$row['balance'];

    echo json_encode(['status' => 'success', 'new_balance' => $new_balance]);
    exit;
}

if ($action === 'pay_with_balance') {
    $offer_id   = (int)($_POST['offer_id'] ?? 0);
    $buyer_name = $conn->real_escape_string($_POST['buyer_name'] ?? '');

    $res = $conn->query("SELECT o.*, r.parsed_items, r.location FROM offers o JOIN requests r ON o.request_id = r.id WHERE o.id = $offer_id");
    $offer = $res->fetch_assoc();
    if (!$offer) { echo json_encode(['error' => 'Offer not found']); exit; }

    $price = (int)$offer['price'];

    // Check buyer balance
    $br = $conn->query("SELECT balance FROM users WHERE display_name='$buyer_name' LIMIT 1");
    $buyer = $br->fetch_assoc();
    if (!$buyer || (float)$buyer['balance'] < $price) {
        echo json_encode(['error' => 'Insufficient balance. Please top up first.']); exit;
    }

    // Deduct buyer, credit seller
    $seller_name = $conn->real_escape_string($offer['seller_name']);
    $conn->query("UPDATE users SET balance = balance - $price WHERE display_name = '$buyer_name'");
    $conn->query("UPDATE users SET earnings = earnings + $price WHERE display_name = '$seller_name'");

    // Create completed order
    $stmt = $conn->prepare("INSERT INTO orders (buyer_name, seller_name, product_name, total_price, image_path, payment_method, status) VALUES (?, ?, ?, ?, ?, 'balance', 'completed')");
    $stmt->bind_param("sssis", $buyer_name, $offer['seller_name'], $offer['product_name'], $price, $offer['image_path']);
    $stmt->execute();

    // Cleanup request
    $req_id = $offer['request_id'];
    $conn->query("DELETE FROM requests WHERE id = $req_id");
    $conn->query("DELETE FROM offers WHERE request_id = $req_id");

    $br2 = $conn->query("SELECT balance FROM users WHERE display_name='$buyer_name' LIMIT 1");
    $new_balance = (float)$br2->fetch_assoc()['balance'];
    echo json_encode(['status' => 'success', 'new_balance' => $new_balance]);
    exit;
}

if ($action === 'withdraw') {
    $uid    = $conn->real_escape_string($_POST['user_id'] ?? '');
    $amount = (int)($_POST['amount'] ?? 0);

    $er = $conn->query("SELECT earnings FROM users WHERE display_name='$uid' LIMIT 1");
    $row = $er->fetch_assoc();
    if (!$row || (float)$row['earnings'] < $amount) {
        echo json_encode(['error' => 'Insufficient earnings']); exit;
    }

    $conn->query("UPDATE users SET earnings = earnings - $amount WHERE display_name = '$uid'");
    $er2 = $conn->query("SELECT earnings FROM users WHERE display_name='$uid' LIMIT 1");
    $new_earnings = (float)$er2->fetch_assoc()['earnings'];
    echo json_encode(['status' => 'success', 'new_earnings' => $new_earnings]);
    exit;
}

// --- 🛒 APP ENDPOINTS ---

if ($action === 'create_request') {
    $buyer = $_POST['buyer_name'] ?? 'Buyer'; 
    $desc = $_POST['description'] ?? '';
    $loc = $_POST['location'] ?? null;
    
    $parsed = [];
    $desc_lower = strtolower($desc);
    
    if (preg_match_all('/(\d+)\s*([a-z\s]+)|([a-z\s]+)\s*(\d+)/i', $desc_lower, $matches, PREG_SET_ORDER)) {
        foreach($matches as $m) {
            if (!empty($m[1]) && !empty($m[2])) { $parsed[] = ['item' => trim($m[2]), 'qty' => (int)$m[1]]; }
            elseif (!empty($m[3]) && !empty($m[4])) { $parsed[] = ['item' => trim($m[3]), 'qty' => (int)$m[4]]; }
        }
    }
    if (empty($parsed)) { $parsed[] = ['item' => trim($desc), 'qty' => 1]; }
    
    $parsed_json = json_encode($parsed);
    $stmt = $conn->prepare("INSERT INTO requests (buyer_name, description, parsed_items, location) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("ssss", $buyer, $desc, $parsed_json, $loc);
    $stmt->execute();
    
    echo json_encode(['status' => 'success', 'request_id' => $stmt->insert_id]);
    exit;
}

if ($action === 'close_request') {
    $id = (int)($_POST['request_id'] ?? 0);
    $conn->query("DELETE FROM requests WHERE id = $id");
    $conn->query("DELETE FROM offers WHERE request_id = $id");
    echo json_encode(['status' => 'success']);
    exit;
}

if ($action === 'add_offer') {
    $image_path = null;
    $upload_error = null;
    $req_id  = (int)($_POST['request_id'] ?? 0);
    $use_remote = $_POST['use_remote'] ?? 'false';
    
    if ($use_remote === 'true') {
        $temp_path = "uploads/remote_req_{$req_id}.jpg";
        if (file_exists($temp_path)) {
            $filename = uniqid() . ".jpg";
            rename($temp_path, 'uploads/' . $filename); 
            $image_path = 'uploads/' . $filename;
        }
    } 
    else if (isset($_FILES['food_image']) && $_FILES['food_image']['error'] !== UPLOAD_ERR_NO_FILE) {
        if ($_FILES['food_image']['error'] === UPLOAD_ERR_OK) {
            $ext = pathinfo($_FILES['food_image']['name'], PATHINFO_EXTENSION);
            $filename = uniqid() . "." . $ext;
            if (!is_dir('uploads')) { mkdir('uploads', 0777, true); }
            if (move_uploaded_file($_FILES['food_image']['tmp_name'], 'uploads/' . $filename)) {
                $image_path = 'uploads/' . $filename;
            } else {
                $upload_error = "Failed to move file to uploads folder.";
            }
        } else {
            $upload_error = "PHP Error Code: " . $_FILES['food_image']['error'];
        }
    }

    $seller  = $_POST['seller_name'] ?? 'Unknown';
    $product = $_POST['product_name'] ?? 'Unknown';
    $price   = (int)($_POST['price'] ?? 0);

    $stmt = $conn->prepare("INSERT INTO offers (request_id, seller_name, product_name, price, image_path) VALUES (?, ?, ?, ?, ?)");
    
    if (!$stmt) {
        echo json_encode(['error' => 'SQL Error: ' . $conn->error]);
        exit;
    }

    $stmt->bind_param("issis", $req_id, $seller, $product, $price, $image_path);
    
    if ($stmt->execute()) {
        echo json_encode(['status' => 'success', 'upload_error' => $upload_error]);
    } else {
        echo json_encode(['error' => 'Execute Error: ' . $stmt->error]);
    }
    exit;
}

if ($action === 'get_offers') {
    $id = (int)($_GET['request_id'] ?? 0);
    $res = $conn->query("SELECT o.*, u.bank_info, u.phone as seller_phone, u.display_name as seller_display_name FROM offers o LEFT JOIN users u ON o.seller_name = u.display_name WHERE o.request_id = $id");
    echo json_encode($res->fetch_all(MYSQLI_ASSOC));
    exit;
}

// ⚠️ THE FIXED ACCEPT_OFFER FUNCTION
if ($action === 'accept_offer') {
    $offer_id = (int)($_POST['offer_id'] ?? 0);
    $buyer_name = $conn->real_escape_string($_POST['buyer_name'] ?? 'Buyer');
    $payment_method = $conn->real_escape_string($_POST['payment_method'] ?? 'cash');

    $res = $conn->query("SELECT o.*, r.parsed_items, r.location FROM offers o JOIN requests r ON o.request_id = r.id WHERE o.id = $offer_id");
    $offer = $res->fetch_assoc();

    if ($offer) {
        $stmt = $conn->prepare("INSERT INTO orders (buyer_name, seller_name, product_name, total_price, image_path, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')");
        
        // sssiss = 6 variables matching the ? placeholders perfectly
        $stmt->bind_param("sssiss", $buyer_name, $offer['seller_name'], $offer['product_name'], $offer['price'], $offer['image_path'], $payment_method);
        
        if ($stmt->execute()) {
            $req_id = $offer['request_id'];
            $conn->query("DELETE FROM requests WHERE id = $req_id");
            $conn->query("DELETE FROM offers WHERE request_id = $req_id");
            echo json_encode(['status' => 'success']);
        } else {
            echo json_encode(['status' => 'error', 'message' => 'Database save failed.']);
        }
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Offer not found.']);
    }
    exit;
}

if ($action === 'verify_order') {
    $order_id = (int)($_POST['order_id'] ?? 0);
    $seller_name = $_POST['seller_name'] ?? '';
    $verification_status = $_POST['verification_status'] ?? 'completed'; 
    
    if ($verification_status !== 'completed' && $verification_status !== 'rejected') {
        $verification_status = 'completed'; 
    }
    
    $stmt = $conn->prepare("UPDATE orders SET status = ? WHERE id = ? AND seller_name = ?");
    $stmt->bind_param("sis", $verification_status, $order_id, $seller_name);
    
    if ($stmt->execute()) {
        echo json_encode(['status' => 'success']);
    } else {
        echo json_encode(['status' => 'error']);
    }
    exit;
}

if ($action === 'get_orders') {
    $username = $conn->real_escape_string($_GET['username'] ?? '');
    $role = $conn->real_escape_string($_GET['role'] ?? '');

    if ($role === 'seller') {
        $res = $conn->query("SELECT o.*, u.phone as buyer_phone FROM orders o LEFT JOIN users u ON o.buyer_name = u.display_name WHERE o.seller_name = '$username' ORDER BY o.created_at DESC");
    } else {
        $res = $conn->query("SELECT o.*, u.phone as seller_phone FROM orders o LEFT JOIN users u ON o.seller_name = u.display_name WHERE o.buyer_name = '$username' ORDER BY o.created_at DESC");
    }

    echo json_encode($res->fetch_all(MYSQLI_ASSOC));
    exit;
}

if ($action === 'get_requests') {
    $res = $conn->query("SELECT r.*, u.phone as buyer_phone, u.display_name as buyer_display_name FROM requests r LEFT JOIN users u ON r.buyer_name = u.display_name ORDER BY r.created_at DESC");
    echo json_encode($res->fetch_all(MYSQLI_ASSOC));
    exit;
}

if ($action === 'get_active_request') {
    $buyer_name = $conn->real_escape_string($_GET['buyer_name'] ?? '');
    $res = $conn->query("SELECT * FROM requests WHERE buyer_name = '$buyer_name' ORDER BY created_at DESC LIMIT 1");
    if ($row = $res->fetch_assoc()) {
        echo json_encode(['status' => 'success', 'data' => $row]);
    } else {
        echo json_encode(['status' => 'empty']);
    }
    exit;
}

if ($action === 'suggest_price') {
    $item = $conn->real_escape_string($_GET['item'] ?? '');
    if (empty($item)) { echo json_encode(['price' => null]); exit; }
    $res = $conn->query("SELECT AVG(total_price) as avg_price FROM orders WHERE product_name LIKE '%$item%'");
    $row = $res->fetch_assoc();
    echo json_encode(['price' => $row['avg_price'] ? round($row['avg_price']) : null]);
    exit;
}
?>