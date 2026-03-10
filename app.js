const API_URL = 'api.php';
let currentView = 'buyer'; 
let currentRequestId = null;
let pollInterval = null;
let sellerInterval = null;
let renderedRequestIds = new Set();
let map;
let markers = {};
let lastOffersJSON = ""; 

function toggleRole() { currentView !== 'seller' ? switchView('seller') : switchView('buyer'); }
function toggleHistory() { currentView !== 'history' ? switchView('history') : switchView('buyer'); }

function switchView(view) {
    currentView = view;
    document.getElementById('buyer-view').classList.add('hidden');
    document.getElementById('seller-container').classList.add('hidden');
    document.getElementById('history-container').classList.add('hidden');
    stopSellerPolling();
    if(pollInterval) clearInterval(pollInterval);

    if (view === 'seller') {
        document.getElementById('seller-container').classList.remove('hidden');
        document.getElementById('seller-container').classList.add('flex');
        setTimeout(initMap, 200);
        startSellerPolling();
    } else if (view === 'history') {
        document.getElementById('history-container').classList.remove('hidden');
        document.getElementById('history-container').classList.add('flex');
        loadHistory();
    } else {
        document.getElementById('buyer-view').classList.remove('hidden');
        if (currentRequestId) pollInterval = setInterval(fetchOffers, 2000);
    }
}

// --- 🗺️ MAP LOGIC ---
function initMap() {
    if (!map) {
        map = L.map('seller-map').setView([-6.285, 107.17], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    }
    map.invalidateSize();
}

// --- 🛒 BUYER LOGIC ---
async function sendRequest() {
    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const coords = `${pos.coords.latitude},${pos.coords.longitude}`;
        addMessage(text, 'user');
        input.value = '';
        lastOffersJSON = ""; 

        const fd = new FormData();
        fd.append('action', 'create_request');
        fd.append('description', text);
        fd.append('location', coords);
        
        try {
            const res = await fetch(API_URL, { method: 'POST', body: fd });
            const data = await res.json();
            
            if (data.status === 'success') {
                currentRequestId = data.request_id;
                document.getElementById('finish-btn-container').classList.remove('hidden'); 
                
                // 🟢 FIXED: Added an ID to this message so we can delete it later
                addMessage('<span id="broadcast-text"><i class="fas fa-search text-emerald-400 mr-2 fa-bounce"></i> Broadcasting to nearby sellers...</span>', 'bot');
                
                pollInterval = setInterval(fetchOffers, 2000);
            }
        } catch (error) {
            alert("Network error. Please try again.");
        } finally {
            input.disabled = false;
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            input.focus();
        }

    }, () => { 
        alert("Please enable GPS for accurate delivery location."); 
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
    });
}

async function closeRequest() {
    if (!currentRequestId) return;
    
    const cancelBtn = document.querySelector('#finish-btn-container button');
    const originalText = cancelBtn.innerHTML;
    cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Canceling...';
    cancelBtn.disabled = true;

    const fd = new FormData();
    fd.append('action', 'close_request');
    fd.append('request_id', currentRequestId);
    
    try { await fetch(API_URL, { method: 'POST', body: fd }); } 
    catch (e) { console.error("Failed to cancel on server"); }

    cancelBtn.innerHTML = originalText;
    cancelBtn.disabled = false;
    resetBuyerState("🚫 Request cancelled.");
}

async function fetchOffers() {
    if (!currentRequestId) return;
    const res = await fetch(`${API_URL}?action=get_offers&request_id=${currentRequestId}`);
    const offers = await res.json();
    
    const newJSON = JSON.stringify(offers);
    if (newJSON !== lastOffersJSON) {
        renderAuction(offers);
        lastOffersJSON = newJSON;
    }
}

function renderAuction(offers) {
    const chatArea = document.getElementById('chat-area');
    const old = document.getElementById('offer-container'); if(old) old.remove();
    if (offers.length === 0) return;

    // 🟢 FIXED: Delete the "Broadcasting..." message when offers show up
    const broadcastTxt = document.getElementById('broadcast-text');
    if (broadcastTxt) broadcastTxt.closest('.message-bubble').remove();

    const container = document.createElement('div');
    container.id = 'offer-container';
    container.className = 'bot-msg message-bubble w-full';
    let html = `<div class="font-bold text-emerald-400 mb-2 border-b border-white/10 pb-1">Incoming Offers:</div>`;
    
    offers.forEach(o => {
        const imgTag = o.image_path 
            ? `<img src="${o.image_path}" class="w-24 h-24 object-cover rounded-lg border border-white/10 shrink-0 shadow-md">` 
            : `<div class="w-24 h-24 bg-black/20 rounded-lg border border-white/5 flex items-center justify-center shrink-0 shadow-inner"><i class="fas fa-utensils text-gray-500 text-2xl"></i></div>`;
        
        html += `
        <div class="auction-card mb-3 p-3 bg-white/5 rounded-xl border border-white/5 flex items-center gap-4">
            ${imgTag}
            <div class="flex-1 min-w-0">
                <div class="font-bold text-white text-base truncate">${o.product_name}</div>
                <div class="text-[11px] text-gray-400 uppercase truncate">${o.seller_name}</div>
                <div class="text-emerald-400 font-bold mt-1 text-lg">Rp ${parseInt(o.price).toLocaleString()}</div>
            </div>
            <button onclick="acceptOffer(${o.id})" class="bg-emerald-500 text-black text-sm font-bold px-4 py-2 rounded-lg hover:bg-emerald-400 shrink-0 transition shadow-lg active:scale-95">Accept</button>
        </div>`;
    });
    container.innerHTML = html;
    chatArea.appendChild(container);
    chatArea.scrollTop = chatArea.scrollHeight;
}

async function acceptOffer(offerId) {
    const fd = new FormData();
    fd.append('action', 'accept_offer');
    fd.append('offer_id', offerId);
    const res = await fetch(API_URL, { method: 'POST', body: fd });
    const data = await res.json();
    
    if (data.status === 'success') {
        let totalQty = 0;
        try {
            const items = JSON.parse(data.details);
            items.forEach(i => totalQty += i.qty);
        } catch(e) { totalQty = 1; }
        
        const waMsg = `I want ${data.product} (Quantity: ${totalQty}). Total Price: Rp ${parseInt(data.price).toLocaleString()}`;
        window.open(`https://wa.me/${data.contact}?text=${encodeURIComponent(waMsg)}`, '_blank');
        resetBuyerState("✅ Order Confirmed!");
    }
}

function resetBuyerState(msg) {
    if(pollInterval) clearInterval(pollInterval);
    currentRequestId = null;
    lastOffersJSON = ""; 
    document.getElementById('finish-btn-container').classList.add('hidden');
    
    // 🟢 FIXED: Delete the "Broadcasting..." message if the request is canceled or finished
    const broadcastTxt = document.getElementById('broadcast-text');
    if (broadcastTxt) broadcastTxt.closest('.message-bubble').remove();

    addMessage(msg, 'bot');
    const old = document.getElementById('offer-container'); if(old) old.remove();
}

function addMessage(text, type) {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = `message-bubble ${type === 'user' ? 'user-msg' : 'bot-msg'}`;
    div.innerHTML = text;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
}

// --- 🏪 SELLER LOGIC ---
function startSellerPolling() { loadSellerRequests(); sellerInterval = setInterval(loadSellerRequests, 2000); }
function stopSellerPolling() { if(sellerInterval) clearInterval(sellerInterval); }

async function loadSellerRequests() {
    try {
        const res = await fetch(`${API_URL}?action=get_requests`);
        const requests = await res.json();
        const list = document.getElementById('seller-requests');
        const serverIds = new Set(requests.map(r => parseInt(r.id)));

        renderedRequestIds.forEach(id => {
            if (!serverIds.has(id)) {
                document.getElementById(`request-${id}`)?.remove();
                if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
                renderedRequestIds.delete(id);
            }
        });

        requests.forEach(req => {
            if (renderedRequestIds.has(parseInt(req.id))) return;
            
            if (req.location) {
                const [lat, lng] = req.location.split(',');
                const marker = L.marker([lat, lng]).addTo(map).bindPopup(`Buyer Request: ${req.description}`);
                markers[req.id] = marker;
            }

            let parsedHTML = '';
            let totalQty = 0;
            if (req.parsed_items) {
                const items = JSON.parse(req.parsed_items);
                items.forEach(i => {
                    const cleanItem = i.item.replace(/i want/gi, '').trim(); 
                    parsedHTML += `<span class="bg-blue-500/20 text-blue-300 text-[10px] px-2 py-1 rounded border border-blue-500/30 mr-1">Quantity: ${i.qty}}</span>`;
                    totalQty += i.qty;
                });
                parsedHTML = `<div class="mt-2 flex flex-wrap gap-1">${parsedHTML}</div>`;
            }

            const mapLink = req.location ? `https://www.google.com/maps?q=${req.location}` : "#";

            const card = document.createElement('div');
            card.id = `request-${req.id}`; 
            card.className = "bg-gray-800/40 border border-white/10 p-5 rounded-xl mb-4";
            card.innerHTML = `
                <div class="mb-4">
                    <div class="flex justify-between items-start">
                        <p class="font-bold text-white text-lg">"${req.description}"</p>
                        ${req.location ? `<a href="${mapLink}" target="_blank" class="text-emerald-400 text-xs hover:underline flex items-center gap-1"><i class="fas fa-map-marker-alt"></i> Open Map</a>` : ''}
                    </div>
                    ${parsedHTML}
                </div>
                <form onsubmit="submitOffer(event, ${req.id}, ${totalQty})" class="text-sm space-y-3" enctype="multipart/form-data">
                    <div class="grid grid-cols-2 gap-3">
                        <input name="seller" placeholder="Shop Name" required class="form-input">
                        <input name="product" placeholder="Product" required class="form-input">
                        <input name="unit_price" type="number" placeholder="Price per 1 portion" required class="form-input">
                        <input name="contact" placeholder="WA (628...)" required class="form-input">
                    </div>
                    
                    <div class="flex flex-col gap-2 mt-2 bg-black/30 p-3 rounded-lg border border-white/5">
                        <label class="text-xs text-emerald-400 font-bold flex items-center gap-2"><i class="fas fa-camera"></i> Upload Food Image (Optional)</label>
                        <input type="file" name="food_image" accept="image/*" onchange="previewImage(event, ${req.id})" class="text-[10px] text-gray-300 file:bg-emerald-500/20 file:border-none file:text-emerald-400 file:px-3 file:py-1.5 file:rounded-md file:cursor-pointer file:font-bold w-full cursor-pointer">
                        
                        <div id="image-preview-container-${req.id}" class="hidden mt-1 relative inline-block w-24 h-24">
                            <img id="image-preview-${req.id}" src="" class="w-24 h-24 object-cover rounded-lg border border-emerald-500/50 shadow-lg shadow-emerald-500/10">
                            <button type="button" onclick="clearImage(${req.id})" class="absolute -top-2 -right-2 bg-red-500/90 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-red-500 shadow-md backdrop-blur-sm transition"><i class="fas fa-times"></i></button>
                        </div>
                    </div>

                    <button type="submit" class="action-btn w-full py-2 mt-2 active:scale-95">Send Offer</button>
                </form>`;
            list.prepend(card);
            renderedRequestIds.add(parseInt(req.id));
        });
    } catch(e) {}
}

// --- 📸 IMAGE LOGIC ---
function previewImage(event, reqId) {
    const file = event.target.files[0];
    const container = document.getElementById(`image-preview-container-${reqId}`);
    const img = document.getElementById(`image-preview-${reqId}`);
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            img.src = e.target.result;
            container.classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    } else {
        clearImage(reqId);
    }
}

function clearImage(reqId) {
    const fileInput = document.querySelector(`#request-${reqId} input[type="file"]`);
    if(fileInput) fileInput.value = "";
    document.getElementById(`image-preview-${reqId}`).src = "";
    document.getElementById(`image-preview-container-${reqId}`).classList.add('hidden');
}

function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 800; 

                if (width > height && width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                } else if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                }, 'image/jpeg', 0.8);
            };
        };
    });
}

async function submitOffer(e, reqId, qty) {
    e.preventDefault();
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    const fd = new FormData(e.target);
    const unitPrice = parseInt(fd.get('unit_price'));
    const totalPrice = unitPrice * qty;

    const fileInput = e.target.querySelector('input[type="file"]');
    if (fileInput && fileInput.files.length > 0) {
        const compressedFile = await compressImage(fileInput.files[0]);
        fd.set('food_image', compressedFile);
    }

    fd.append('action', 'add_offer');
    fd.append('request_id', reqId);
    fd.append('seller_name', fd.get('seller'));   
    fd.append('product_name', fd.get('product')); 
    fd.set('price', totalPrice); 

    try {
        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const text = await res.text(); 
        
        try {
            const data = JSON.parse(text); 
            if (data.error) { alert("Database Error: " + data.error); }
            if (data.upload_error) { alert("Image Error: " + data.upload_error); }
            
            clearImage(reqId);
            e.target.innerHTML = `<p class='text-emerald-400 font-bold text-center py-2'>Offer Sent! <br><span class="text-[10px] text-white">Total: Rp ${totalPrice.toLocaleString()}</span></p>`;
        } catch (jsonErr) {
            console.error("RAW PHP ERROR:", text);
            alert("PHP Error: Press F12 and check the Console.");
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch(err) {
        alert("Failed to connect. Is XAMPP running?");
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// --- 🧾 HISTORY LOGIC ---
async function loadHistory() {
    const list = document.getElementById('history-list');
    const res = await fetch(`${API_URL}?action=get_orders`);
    const orders = await res.json();
    
    list.innerHTML = orders.map(order => {
        const date = new Date(order.created_at).toLocaleString();
        const historyMapLink = order.location ? `https://www.google.com/maps?q=${order.location}` : "#";
        const imgTag = order.image_path ? `<img src="${order.image_path}" class="w-20 h-20 object-cover rounded-md mr-4 border border-white/10 shrink-0 shadow-md">` : '';
        
        return `
        <div class="bg-gray-800/50 border border-white/10 p-4 rounded-xl mb-3 flex items-center">
            ${imgTag}
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start mb-1">
                    <div class="truncate pr-2">
                        <div class="font-bold text-white text-base truncate">${order.product_name}</div>
                        <div class="text-xs text-gray-400 truncate mt-0.5">Seller: ${order.seller_name}</div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="text-emerald-400 font-bold text-lg">Rp ${parseInt(order.total_price).toLocaleString()}</div>
                        ${order.location ? `<a href="${historyMapLink}" target="_blank" class="text-[10px] text-blue-400 hover:text-blue-300 hover:underline mt-1 block">Delivery Location</a>` : ''}
                    </div>
                </div>
                <div class="text-[10px] text-gray-500 text-right mt-1">${date}</div>
            </div>
        </div>`;
    }).join('') || '<p class="text-center text-gray-500 mt-10">No past orders found.</p>';
}