<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

$conn = new mysqli("localhost", "root", "", "smartstore");
if ($conn->connect_error) { die(json_encode(["error" => "Connection failed"])); }

$action = $_REQUEST['action'] ?? '';

// Auto-clean old data
$conn->query("DELETE FROM requests WHERE created_at < NOW() - INTERVAL 12 HOUR");

if ($action === 'create_request') {
    $buyer = 'Buyer'; 
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
    
    if (isset($_FILES['food_image']) && $_FILES['food_image']['error'] !== UPLOAD_ERR_NO_FILE) {
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

    $req_id  = (int)($_POST['request_id'] ?? 0);
    $seller  = $_POST['seller_name'] ?? $_POST['seller'] ?? 'Unknown';
    $product = $_POST['product_name'] ?? $_POST['product'] ?? 'Unknown';
    $price   = (int)($_POST['price'] ?? 0);
    $contact = $_POST['contact'] ?? '';

    $stmt = $conn->prepare("INSERT INTO offers (request_id, seller_name, product_name, price, contact, image_path) VALUES (?, ?, ?, ?, ?, ?)");
    
    if (!$stmt) {
        echo json_encode(['error' => 'SQL Error: ' . $conn->error]);
        exit;
    }

    $stmt->bind_param("ississ", $req_id, $seller, $product, $price, $contact, $image_path);
    
    if ($stmt->execute()) {
        echo json_encode(['status' => 'success', 'upload_error' => $upload_error]);
    } else {
        echo json_encode(['error' => 'Execute Error: ' . $stmt->error]);
    }
    exit;
}

if ($action === 'get_offers') {
    $id = (int)($_GET['request_id'] ?? 0);
    $res = $conn->query("SELECT * FROM offers WHERE request_id = $id");
    echo json_encode($res->fetch_all(MYSQLI_ASSOC));
    exit;
}

if ($action === 'accept_offer') {
    $offer_id = (int)($_POST['offer_id'] ?? 0);
    $res = $conn->query("SELECT o.*, r.parsed_items, r.location FROM offers o JOIN requests r ON o.request_id = r.id WHERE o.id = $offer_id");
    $offer = $res->fetch_assoc();

    if ($offer) {
        $stmt = $conn->prepare("INSERT INTO orders (buyer_name, seller_name, product_name, total_price, location, image_path) VALUES ('Buyer', ?, ?, ?, ?, ?)");
        $stmt->bind_param("ssiss", $offer['seller_name'], $offer['product_name'], $offer['price'], $offer['location'], $offer['image_path']);
        $stmt->execute();
        
        $req_id = $offer['request_id'];
        $conn->query("DELETE FROM requests WHERE id = $req_id");
        $conn->query("DELETE FROM offers WHERE request_id = $req_id");
        
        echo json_encode([
            'status' => 'success', 
            'contact' => $offer['contact'], 
            'product' => $offer['product_name'], 
            'price' => $offer['price'], 
            'details' => $offer['parsed_items']
        ]);
    }
    exit;
}

if ($action === 'get_orders') {
    $res = $conn->query("SELECT * FROM orders ORDER BY created_at DESC");
    echo json_encode($res->fetch_all(MYSQLI_ASSOC));
    exit;
}

if ($action === 'get_requests') {
    $res = $conn->query("SELECT * FROM requests ORDER BY created_at DESC");
    echo json_encode($res->fetch_all(MYSQLI_ASSOC));
    exit;
}
?>