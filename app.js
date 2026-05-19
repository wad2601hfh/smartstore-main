const API_URL = 'api.php';
const BUYER_KEY  = 'smartstore_buyer';
const SELLER_KEY = 'smartstore_seller';
let loggedInUser = null;
let activeRole = 'buyer';

let currentView = 'buyer';
let currentRequestId = null;
let pollInterval = null;
let sellerInterval = null;
let renderedRequestIds = new Set();
let map;
let markers = {};
let lastOffersJSON = "";

let webcamStreams = {};
let webcamFiles = {};
let remotePolling = {};
let globalPeer = null;

// ===================== IDENTITY / SETTINGS SYSTEM =====================

// Always show role picker on every page load
window.onload = () => {
    showSettingsModal();
    showSetupStep('role');
};

function getSavedIdentity(role) {
    const key = role === 'buyer' ? BUYER_KEY : SELLER_KEY;
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
}

function saveIdentityLocal(data) {
    const key = data.role === 'buyer' ? BUYER_KEY : SELLER_KEY;
    localStorage.setItem(key, JSON.stringify(data));
    loggedInUser = data;
}

async function syncUserToServer(identity) {
    try {
        const fd = new FormData();
        fd.append('action', 'upsert_user');
        fd.append('display_name', identity.display_name);
        fd.append('role', identity.role);
        fd.append('phone', identity.phone || '');
        fd.append('bank_info', identity.bank_info || '');
        await fetch(API_URL, { method: 'POST', body: fd });
    } catch (e) { }
}

// ===== WhatsApp Support =====
function openWaSupport(role) {
    const supportNumber = '6281234567890';
    const msg = role === 'seller'
        ? `Halo, saya seller di Smart Store (ID: ${loggedInUser?.username}). Butuh bantuan.`
        : `Halo, saya buyer di Smart Store (ID: ${loggedInUser?.username}). Butuh bantuan.`;
    window.open(`https://wa.me/${supportNumber}?text=${encodeURIComponent(msg)}`, '_blank');
}

function openWaSeller(phone, sellerName) {
    if (!phone) { alert('Seller has not provided a WhatsApp number.'); return; }
    const clean = phone.replace(/\D/g, '');
    const msg = `Halo ${sellerName}, saya ingin bertanya tentang pesanan di Smart Store.`;
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ===== TOP UP =====
function openTopupModal() {
    if (!loggedInUser) return;
    document.getElementById('topup-current-balance').textContent =
        'Rp ' + parseInt(loggedInUser._balance || 0).toLocaleString('id-ID');
    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-error').classList.add('ss-hidden');
    const m = document.getElementById('topup-modal');
    m.classList.remove('ss-hidden');
}
function closeTopupModal() {
    const m = document.getElementById('topup-modal');
    m.classList.add('ss-hidden');
}
function setTopupAmount(v) { document.getElementById('topup-amount').value = v; }
async function submitTopup() {
    const amount = parseInt(document.getElementById('topup-amount').value || 0);
    const errEl = document.getElementById('topup-error');
    const btn = document.getElementById('topup-submit-btn');
    errEl.classList.add('ss-hidden');
    if (amount < 10000) { errEl.textContent = 'Minimum top up is Rp 10.000'; errEl.classList.remove('ss-hidden'); return; }
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Processing...';
    btn.disabled = true;
    const fd = new FormData();
    fd.append('action', 'topup');
    fd.append('user_id', loggedInUser.username);
    fd.append('amount', amount);
    fd.append('method', 'demo');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') {
            loggedInUser._balance = data.new_balance;
            const fmt = v => 'Rp ' + parseInt(v).toLocaleString('id-ID');
            const bt = document.getElementById('buyer-balance-text');
            if (bt) bt.textContent = fmt(data.new_balance);
            document.getElementById('topup-current-balance').textContent = fmt(data.new_balance);
            closeTopupModal();
            addMessage(`<i class="fas fa-check-circle" style="color:#2A9D8F"></i> Top up <strong>${fmt(amount)}</strong> successful! Your new balance: <strong>${fmt(data.new_balance)}</strong>`, 'bot');
        } else {
            errEl.textContent = data.error || 'Top up failed.';
            errEl.classList.remove('ss-hidden');
        }
    } catch (err) { errEl.textContent = 'Network error.'; errEl.classList.remove('ss-hidden'); }
    btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Top Up Now';
    btn.disabled = false;
}

// ===== WITHDRAW =====
function openWithdrawModal() {
    if (!loggedInUser) return;
    const fmt = v => 'Rp ' + parseInt(v).toLocaleString('id-ID');
    document.getElementById('withdraw-available').textContent = fmt(loggedInUser._earnings || 0);
    document.getElementById('withdraw-bank-info').textContent = loggedInUser.bank_info || 'No bank account set — update in Settings';
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-error').classList.add('ss-hidden');
    const m = document.getElementById('withdraw-modal');
    m.classList.remove('ss-hidden');
}
function closeWithdrawModal() {
    const m = document.getElementById('withdraw-modal');
    m.classList.add('ss-hidden');
}
function setWithdrawMax() {
    document.getElementById('withdraw-amount').value = Math.floor(loggedInUser._earnings || 0);
}
async function submitWithdraw() {
    const amount = parseInt(document.getElementById('withdraw-amount').value || 0);
    const errEl = document.getElementById('withdraw-error');
    const btn = document.getElementById('withdraw-submit-btn');
    errEl.classList.add('ss-hidden');
    if (amount < 10000) { errEl.textContent = 'Minimum withdrawal is Rp 10.000'; errEl.classList.remove('ss-hidden'); return; }
    if (amount > (loggedInUser._earnings || 0)) { errEl.textContent = 'Amount exceeds available earnings.'; errEl.classList.remove('ss-hidden'); return; }
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Processing...';
    btn.disabled = true;
    const fd = new FormData();
    fd.append('action', 'withdraw');
    fd.append('user_id', loggedInUser.username);
    fd.append('amount', amount);
    try {
        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') {
            loggedInUser._earnings = data.new_earnings;
            const fmt = v => 'Rp ' + parseInt(v).toLocaleString('id-ID');
            const et = document.getElementById('seller-earnings-text');
            if (et) et.textContent = fmt(data.new_earnings);
            closeWithdrawModal();
        } else {
            errEl.textContent = data.error || 'Withdrawal failed.';
            errEl.classList.remove('ss-hidden');
        }
    } catch (err) { errEl.textContent = 'Network error.'; errEl.classList.remove('ss-hidden'); }
    btn.innerHTML = '<i class="fas fa-check mr-1"></i>Request Withdrawal';
    btn.disabled = false;
}

function pickRole(role) {
    const saved = getSavedIdentity(role);
    if (saved) {
        loggedInUser = saved;
        closeSettingsModal();
        initApp();
    } else {
        document.getElementById(role + '-back-btn').classList.remove('ss-hidden');
        showSetupStep(role);
    }
}

// 🌟 FIX: Resetting and Clearing DOM properly to prevent double render when switching roles!
function switchToRole(role) {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    stopSellerPolling();
    currentRequestId = null;
    lastOffersJSON = "";
    
    // Clear DOM and map to prevent duplicate requests
    const sellerRequestsList = document.getElementById('seller-requests');
    if (sellerRequestsList) sellerRequestsList.innerHTML = '';
    
    if (map) {
        for (let id in markers) {
            map.removeLayer(markers[id]);
        }
    }
    markers = {};
    renderedRequestIds.clear();

    const saved = getSavedIdentity(role);
    if (saved) {
        loggedInUser = saved;
        initApp();
    } else {
        showSettingsModal();
        document.getElementById(role + '-back-btn').classList.remove('ss-hidden');
        showSetupStep(role);
    }
}

function initApp() {
    activeRole = loggedInUser.role;
    updateHeaders();
    closeSettingsModal();
    switchView(activeRole);
    if (activeRole === 'buyer') {
        restoreChatHistory(loggedInUser.username);
    }
    syncUserToServer(loggedInUser);
    loadWalletData();
}

async function loadWalletData() {
    if (!loggedInUser) return;
    try {
        const res = await fetch(`${API_URL}?action=get_balance&user_id=${encodeURIComponent(loggedInUser.username)}`);
        const data = await res.json();
        const fmt = v => 'Rp ' + parseInt(v).toLocaleString('id-ID');
        const bt = document.getElementById('buyer-balance-text');
        const et = document.getElementById('seller-earnings-text');
        if (bt) bt.textContent = fmt(data.balance || 0);
        if (et) et.textContent = fmt(data.earnings || 0);
        loggedInUser._balance = data.balance || 0;
        loggedInUser._earnings = data.earnings || 0;
    } catch (e) {}
}

function updateHeaders() {
    const bh = document.getElementById('buyer-header');
    const sh = document.getElementById('seller-header');

    if (activeRole === 'seller') {
        bh.classList.add('ss-hidden');
        sh.classList.remove('ss-hidden');
        const nameEl = document.getElementById('seller-header-name');
        if (nameEl) nameEl.textContent = loggedInUser.display_name || 'Seller Center';
        document.body.style.background = '#F4F6F8';
        document.body.classList.add('seller-theme');
    } else {
        sh.classList.add('ss-hidden');
        bh.classList.remove('ss-hidden');
        const nameEl = document.getElementById('buyer-header-name');
        if (nameEl) nameEl.textContent = loggedInUser.display_name || 'Smart Store';
        document.body.style.background = '#FFFBFA';
        document.body.classList.remove('seller-theme');
    }
}

// ---- Settings Modal controls ----
function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('ss-hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('ss-hidden');
}

function openSettings() {
    const role = loggedInUser ? loggedInUser.role : 'buyer';
    prePopulateForm(role);
    showSettingsModal();
    showSetupStep(role);
    document.getElementById(role + '-back-btn').classList.add('ss-hidden');
}

function showSetupStep(step) {
    ['role', 'buyer', 'seller'].forEach(s => {
        const el = document.getElementById('setup-' + s);
        if (el) { el.classList.add('ss-hidden'); }
    });
    const target = document.getElementById('setup-' + step);
    if (target) {
        target.classList.remove('ss-hidden');
        const card = target.querySelector('div');
        if (card) {
            card.classList.remove('auth-slide-in');
            void card.offsetWidth;
            card.classList.add('auth-slide-in');
        }
    }
}

function goBackSetup() {
    showSetupStep('role');
}

function prePopulateForm(role) {
    const saved = getSavedIdentity(role);
    if (!saved) return;
    if (role === 'buyer') {
        const form = document.getElementById('buyer-setup-form');
        if (!form) return;
        const nameInput = form.querySelector('[name="display_name"]');
        if (nameInput) nameInput.value = saved.display_name || '';
        const phoneInput = form.querySelector('[name="phone"]');
        if (phoneInput) phoneInput.value = saved.phone || '';
        document.getElementById('buyer-setup-title').textContent = 'Edit Your Profile';
        document.getElementById('buyer-setup-btn').innerHTML = '<i class="fas fa-check mr-1"></i>Save Changes';
    } else {
        const form = document.getElementById('seller-setup-form');
        if (!form) return;
        form.querySelector('[name="display_name"]').value = saved.display_name || '';
        form.querySelector('[name="phone"]').value = saved.phone || '';
        form.querySelector('[name="bank_info"]').value = saved.bank_info || '';
        document.getElementById('seller-setup-title').textContent = 'Edit Shop Settings';
        document.getElementById('seller-setup-btn').innerHTML = '<i class="fas fa-check mr-1"></i>Save Changes';
    }
}

async function saveBuyerSetup(e) {
    e.preventDefault();
    const form = e.target;
    const displayName = form.querySelector('[name="display_name"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const errEl = document.getElementById('buyer-setup-error');
    const btn = document.getElementById('buyer-setup-btn');

    errEl.classList.add('ss-hidden');
    if (!displayName) { errEl.textContent = 'Please enter your name.'; errEl.classList.remove('ss-hidden'); return; }
    if (!phone) { errEl.textContent = 'Please enter your WhatsApp number.'; errEl.classList.remove('ss-hidden'); return; }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const saved = getSavedIdentity('buyer');
    const oldName = saved ? saved.username : '';
    if (oldName && oldName !== displayName) {
        localStorage.removeItem(BUYER_KEY);
    }

    const identity = { username: displayName, display_name: displayName, role: 'buyer', phone: phone, bank_info: '' };
    saveIdentityLocal(identity);
    await syncUserToServer(identity);
    btn.innerHTML = '<i class="fas fa-bolt mr-1"></i>Save & Start Ordering';
    btn.disabled = false;
    loggedInUser = identity;
    initApp();
}

async function saveSellerSetup(e) {
    e.preventDefault();
    const form = e.target;
    const displayName = form.querySelector('[name="display_name"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const bankInfo = form.querySelector('[name="bank_info"]').value.trim();
    const errEl = document.getElementById('seller-setup-error');
    const btn = document.getElementById('seller-setup-btn');

    errEl.classList.add('ss-hidden');
    if (!displayName) { errEl.textContent = 'Please enter your shop name.'; errEl.classList.remove('ss-hidden'); return; }
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const saved = getSavedIdentity('seller');
    const oldName = saved ? saved.username : '';
    if (oldName && oldName !== displayName) {
        localStorage.removeItem(SELLER_KEY);
    }

    const identity = { username: displayName, display_name: displayName, role: 'seller', phone, bank_info: bankInfo };
    saveIdentityLocal(identity);
    await syncUserToServer(identity);
    btn.innerHTML = '<i class="fas fa-rocket mr-1"></i>Save & Start Selling';
    btn.disabled = false;
    loggedInUser = identity;
    initApp();
}

function toggleHistory() {
    currentView !== 'history' ? switchView('history') : switchView(activeRole);
}

function switchView(view) {
    currentView = view;
    document.getElementById('buyer-view').classList.add('ss-hidden');
    document.getElementById('seller-container').classList.add('ss-hidden');
    document.getElementById('history-container').classList.add('ss-hidden');
    stopSellerPolling();
    if (pollInterval) clearInterval(pollInterval);

    if (view === 'seller') {
        document.getElementById('seller-container').classList.remove('ss-hidden');
        setTimeout(initMap, 200);
        startSellerPolling();
    } else if (view === 'history') {
        document.getElementById('history-container').classList.remove('ss-hidden');
        loadHistory();
    } else {
        document.getElementById('buyer-view').classList.remove('ss-hidden');

        if (!currentRequestId && loggedInUser && loggedInUser.role === 'buyer') {
            fetch(`${API_URL}?action=get_active_request&buyer_name=${encodeURIComponent(loggedInUser.username)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success' && data.data) {
                        currentRequestId = data.data.id;
                        const chatArea = document.getElementById('chat-area');
                        chatArea.innerHTML = '';

                        addMessage(`<i class="fas fa-history"></i> Restored your active request...`, 'bot');
                        addMessage(data.data.description, 'user');
                        addMessage('<span id="broadcast-text"><i class="fas fa-search text-emerald-400 mr-2 fa-bounce"></i> Broadcasting to nearby sellers...</span>', 'bot');

                        document.getElementById('finish-btn-container').classList.remove('ss-hidden');
                        pollInterval = setInterval(fetchOffers, 2000);
                        fetchOffers();
                    }
                })
                .catch(err => console.error("Could not restore session", err));
        } else if (currentRequestId && !pollInterval) {
            pollInterval = setInterval(fetchOffers, 2000);
        }
    }
}

function initMap() {
    if (!map) {
        map = L.map('seller-map').setView([-6.285, 107.17], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    }
    map.invalidateSize();
}

async function sendRequest() {
    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

    async function processOrder(coords, warningMsg = null) {
        if (warningMsg) addMessage(`<i class="fas fa-exclamation-triangle text-yellow-400"></i> ${warningMsg}`, 'bot');
        addMessage(text, 'user');
        input.value = '';
        lastOffersJSON = "";

        const fd = new FormData();
        fd.append('action', 'create_request');
        fd.append('description', text);
        fd.append('location', coords);
        fd.append('buyer_name', loggedInUser.username);

        try {
            const res = await fetch(API_URL, { method: 'POST', body: fd });
            const data = await res.json();

            if (data.status === 'success') {
                currentRequestId = data.request_id;
                document.getElementById('finish-btn-container').classList.remove('ss-hidden');
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
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            processOrder(`${pos.coords.latitude},${pos.coords.longitude}`);
        },
        (err) => {
            console.warn("GPS failed, using fallback location.");
            processOrder("-6.285,107.17", "Could not find exact GPS. Using approximate location for testing.");
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 10000 }
    );
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

    try { await fetch(API_URL, { method: 'POST', body: fd }); } catch (e) { }

    cancelBtn.innerHTML = originalText;
    cancelBtn.disabled = false;
    resetBuyerState("🚫 Request cancelled.");
}

async function fetchOffers() {
    if (!currentRequestId) return;
    try {
        const res = await fetch(`${API_URL}?action=get_offers&request_id=${currentRequestId}`);
        const text = await res.text();
        let offers;
        try { offers = JSON.parse(text); }
        catch (jsonErr) { console.error('get_offers bad JSON:', text); return; }
        if (!Array.isArray(offers)) { console.error('get_offers error:', offers); return; }
        const newJSON = JSON.stringify(offers);
        if (newJSON !== lastOffersJSON) {
            renderAuction(offers);
            lastOffersJSON = newJSON;
        }
    } catch (e) { console.error('fetchOffers failed:', e); }
}

function renderAuction(offers) {
    const chatArea = document.getElementById('chat-area');
    const old = document.getElementById('offer-container'); if (old) old.remove();
    if (offers.length === 0) return;

    const broadcastTxt = document.getElementById('broadcast-text');
    if (broadcastTxt) broadcastTxt.closest('.message-bubble').remove();

    const container = document.createElement('div');
    container.id = 'offer-container';
    container.style.cssText = 'width:100%; display:block;';
    container.className = 'animate-fade';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.7rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#F4A261;margin-bottom:10px;padding-left:2px;';
    label.innerHTML = '<i class="fas fa-store mr-1"></i> Offers for you';
    container.appendChild(label);

    offers.forEach(o => {
        const imgTag = o.image_path
            ? `<img src="${o.image_path}" style="width:80px;height:80px;object-fit:cover;border-radius:12px;flex-shrink:0;box-shadow:0 2px 10px rgba(0,0,0,0.12);">`
            : `<div style="width:80px;height:80px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#FFF0E5;color:#F4A261;font-size:1.6rem;"><i class="fas fa-utensils"></i></div>`;

        const displayName = o.seller_display_name || o.seller_name || 'Seller';
        const bankInfoSafe = o.bank_info ? o.bank_info.replace(/'/g, "\\'") : "Ask seller for bank details";
        const sellerPhoneSafe = (o.seller_phone || '').replace(/\D/g, '');
        
        const waMessage = encodeURIComponent(`Halo ${displayName}, saya ingin bertanya tentang pesanan di Smart Store.`);
        const waUrl = sellerPhoneSafe ? `https://wa.me/${sellerPhoneSafe}?text=${waMessage}` : `javascript:alert('Seller has not provided a WhatsApp number.')`;

        const card = document.createElement('div');
        card.className = 'auction-card';
        card.style.cssText = 'display:flex;flex-direction:column;padding:12px;gap:8px;margin-bottom:12px;flex-shrink:0;';
        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;">
                ${imgTag}
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;color:#1a1a2e;font-size:0.95rem;">${o.product_name}</div>
                    <div style="font-size:0.7rem;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${displayName}</div>
                    <div style="font-size:1.15rem;font-weight:900;color:#F4A261;margin-top:4px;">Rp ${parseInt(o.price).toLocaleString('id-ID')}</div>
                </div>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;">
                <button onclick="payWithBalance(${o.id}, ${o.price})"
                    style="flex:1;min-width:100px;background:#2A9D8F;color:white;font-weight:700;font-size:0.78rem;padding:9px 10px;border-radius:11px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;"
                    onmouseover="this.style.background='#21867A'" onmouseout="this.style.background='#2A9D8F'">
                    <i class="fas fa-wallet"></i> Pay with Balance
                </button>
                <button onclick="openReceiptModal(${o.id}, '${displayName.replace(/'/g, "\\'")}', '${bankInfoSafe}', ${o.price})"
                    style="flex:1;min-width:100px;background:#E63946;color:white;font-weight:700;font-size:0.78rem;padding:9px 10px;border-radius:11px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;"
                    onmouseover="this.style.background='#C1121F'" onmouseout="this.style.background='#E63946'">
                    <i class="fas fa-qrcode"></i> QRIS / Cash
                </button>
                <a href="${waUrl}" target="_blank"
                    style="background:#25D366;color:white;font-weight:700;font-size:0.78rem;padding:9px 12px;border-radius:11px;border:none;cursor:pointer;display:flex;align-items:center;gap:5px;text-decoration:none;"
                    title="Chat seller via WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                </a>
            </div>`;
        container.appendChild(card);
    });

    chatArea.appendChild(container);
    chatArea.scrollTop = chatArea.scrollHeight;
}

async function payWithBalance(offerId, price) {
    const fmt = v => 'Rp ' + parseInt(v).toLocaleString('id-ID');
    const bal = loggedInUser._balance || 0;
    if (bal < price) {
        const shortfall = price - bal;
        const goTopUp = confirm(`Your balance is ${fmt(bal)}. You need ${fmt(shortfall)} more.\n\nClick OK to top up now.`);
        if (goTopUp) openTopupModal();
        return;
    }
    if (!confirm(`Pay ${fmt(price)} using your wallet balance?\n\nRemaining balance: ${fmt(bal - price)}`)) return;

    const fd = new FormData();
    fd.append('action', 'pay_with_balance');
    fd.append('offer_id', offerId);
    fd.append('buyer_name', loggedInUser.username);
    try {
        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') {
            loggedInUser._balance = data.new_balance;
            const bt = document.getElementById('buyer-balance-text');
            if (bt) bt.textContent = fmt(data.new_balance);
            resetBuyerState(`<i class="fas fa-check-circle" style="color:#2A9D8F"></i> Payment successful! <strong>${fmt(price)}</strong> deducted from your wallet.`);
        } else {
            alert(data.error || 'Payment failed.');
        }
    } catch (err) { alert('Network error.'); }
}

function openReceiptModal(offerId, sellerName, bankInfo, price) {
    const existing = document.getElementById('receipt-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'receipt-modal';
    modal.className = "ss-modal";
    modal.style.zIndex = "100";
    modal.innerHTML = `
        <div style="background:#FFFFFF;border-radius:24px;width:100%;max-width:370px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
            <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:20px;text-align:center;">
                <div style="font-size:1.5rem;margin-bottom:4px;">💳</div>
                <div style="color:white;font-weight:800;font-size:1rem;">Pay to <strong>${sellerName}</strong></div>
                <div style="color:rgba(255,255,255,0.85);font-size:1.4rem;font-weight:900;margin-top:4px;">Rp ${parseInt(price).toLocaleString('id-ID')}</div>
            </div>
            <div style="padding:20px;">
                <div style="background:#FEF3C7;border:1.5px solid #FCD34D;border-radius:12px;padding:10px;text-align:center;margin-bottom:14px;">
                    <p style="font-size:0.72rem;color:#92400E;font-weight:700;"><i class="fas fa-flask mr-1"></i>TRIAL MODE — No real payment processed</p>
                </div>
                <p style="font-size:0.8rem;font-weight:700;color:#374151;margin-bottom:10px;">Choose payment method:</p>
                <div style="display:flex;gap:8px;margin-bottom:16px;">
                    <button onclick="selectPayMethod('cash')" id="pay-cash-btn" style="flex:1;padding:10px 6px;border-radius:12px;border:2px solid #f97316;background:#FFF7ED;color:#92400E;font-weight:700;font-size:0.78rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;">
                        <i class="fas fa-money-bill-wave"></i> Cash
                    </button>
                    <button onclick="selectPayMethod('qris')" id="pay-qris-btn" style="flex:1;padding:10px 6px;border-radius:12px;border:2px solid #E2E8F0;background:#F8FAFC;color:#64748B;font-weight:700;font-size:0.78rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;">
                        <i class="fas fa-qrcode"></i> QRIS
                    </button>
                </div>
                <div id="pay-cash-info" style="background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:12px;padding:14px;margin-bottom:14px;">
                    <p style="font-size:0.75rem;color:#92400E;font-weight:700;"><i class="fas fa-money-bill-wave mr-1"></i>Pay with Cash</p>
                    <p style="font-size:0.7rem;color:#6B7280;margin-top:6px;">Hand the cash directly to the seller when they deliver your order.</p>
                    <p style="font-size:0.7rem;color:#9CA3AF;margin-top:4px;"><i class="fas fa-info-circle mr-1"></i>Click confirm and the seller will be notified.</p>
                </div>
                <div id="pay-qris-info" style="display:none;text-align:center;background:#F0FDF4;border:1.5px solid #A7F3D0;border-radius:12px;padding:14px;margin-bottom:14px;">
                    <p style="font-size:0.7rem;font-weight:700;color:#065F46;margin-bottom:8px;"><i class="fas fa-qrcode mr-1"></i>Example QRIS (Trial Only)</p>
                    <div style="background:#fff;border-radius:10px;padding:10px;display:inline-block;margin-bottom:6px;">
                        <div style="width:100px;height:100px;background:repeating-linear-gradient(0deg,#000 0,#000 4px,#fff 4px,#fff 8px),repeating-linear-gradient(90deg,#000 0,#000 4px,#fff 4px,#fff 8px);opacity:0.15;border-radius:4px;"></div>
                        <div style="font-size:2rem;margin-top:-70px;margin-bottom:30px;">📱</div>
                    </div>
                    <p style="font-size:0.68rem;color:#9CA3AF;">This is a sample QR. No real transaction occurs.</p>
                </div>
                <div style="display:flex;gap:10px;">
                    <button type="button" onclick="document.getElementById('receipt-modal').remove()" style="flex:1;background:#FEE2E2;color:#E63946;font-weight:700;padding:12px;border-radius:12px;border:none;cursor:pointer;font-size:0.85rem;">Cancel</button>
                    <button type="button" onclick="confirmTrialPayment(${offerId})" style="flex:2;background:linear-gradient(135deg,#2A9D8F,#21867A);color:white;font-weight:700;padding:12px;border-radius:12px;border:none;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 14px rgba(42,157,143,0.3);">
                        <i class="fas fa-check-circle"></i> I've Paid — Confirm
                    </button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

let _selectedPayMethod = 'cash';
function selectPayMethod(m) {
    _selectedPayMethod = m;
    const cashBtn = document.getElementById('pay-cash-btn');
    const qrisBtn = document.getElementById('pay-qris-btn');
    const cashInfo = document.getElementById('pay-cash-info');
    const qrisInfo = document.getElementById('pay-qris-info');
    if (m === 'cash') {
        cashBtn.style.borderColor = '#f97316'; cashBtn.style.background = '#FFF7ED'; cashBtn.style.color = '#92400E';
        qrisBtn.style.borderColor = '#E2E8F0'; qrisBtn.style.background = '#F8FAFC'; qrisBtn.style.color = '#64748B';
        cashInfo.style.display = 'block'; qrisInfo.style.display = 'none';
    } else {
        qrisBtn.style.borderColor = '#2A9D8F'; qrisBtn.style.background = '#F0FDF4'; qrisBtn.style.color = '#065F46';
        cashBtn.style.borderColor = '#E2E8F0'; cashBtn.style.background = '#F8FAFC'; cashBtn.style.color = '#64748B';
        qrisInfo.style.display = 'block'; cashInfo.style.display = 'none';
    }
}

async function confirmTrialPayment(offerId) {
    const fd = new FormData();
    fd.append('action', 'accept_offer');
    fd.append('offer_id', offerId);
    fd.append('buyer_name', loggedInUser.username);
    fd.append('payment_method', _selectedPayMethod);
    try {
        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') {
            document.getElementById('receipt-modal').remove();
            resetBuyerState(`<i class="fas fa-check-circle" style="color:#2A9D8F"></i> Payment confirmed! The seller will prepare your order. Check Order History for status.`);
        } else {
            alert(data.message || 'Something went wrong.');
        }
    } catch (err) { alert('Network error.'); }
}

async function submitReceipt(e, offerId) {
    e.preventDefault();
    const btn = document.getElementById('submit-receipt-btn');
    const fileInput = document.getElementById('receipt-file');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    btn.disabled = true;

    try {
        const fd = new FormData();
        fd.append('action', 'accept_offer');
        fd.append('offer_id', offerId);
        fd.append('buyer_name', loggedInUser.username);

        if (fileInput.files.length > 0) {
            const compressedReceipt = await compressImage(fileInput.files[0]);
            fd.append('receipt_image', compressedReceipt);
        }

        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const data = await res.json();

        if (data.status === 'success') {
            document.getElementById('receipt-modal').remove();
            resetBuyerState("⏳ Receipt Uploaded! Waiting for Seller to verify your payment.");
        } else {
            alert(data.message || "Upload failed.");
            btn.innerHTML = '<i class="fas fa-upload"></i> Send Proof';
            btn.disabled = false;
        }
    } catch (err) {
        alert("Network error.");
        btn.innerHTML = '<i class="fas fa-upload"></i> Send Proof';
        btn.disabled = false;
    }
}

function resetBuyerState(msg) {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    currentRequestId = null;
    lastOffersJSON = '';
    document.getElementById('finish-btn-container').classList.add('ss-hidden');

    const offerEl = document.getElementById('offer-container');
    if (offerEl) offerEl.remove();
    const broadcastTxt = document.getElementById('broadcast-text');
    if (broadcastTxt) broadcastTxt.closest('.message-bubble').remove();

    addMessage(msg, 'bot');
}

// ===== CHAT HISTORY PER USER =====
function chatKey(username) { return `smartstore_chat_${username}`; }

function saveChatHistory(username) {
    const chatArea = document.getElementById('chat-area');
    if (!chatArea || !username) return;
    localStorage.setItem(chatKey(username), chatArea.innerHTML);
}

function restoreChatHistory(username) {
    const chatArea = document.getElementById('chat-area');
    if (!chatArea || !username) return false;
    const saved = localStorage.getItem(chatKey(username));
    if (saved) {
        chatArea.innerHTML = saved;
        const staleOffer = chatArea.querySelector('#offer-container');
        if (staleOffer) staleOffer.remove();
        chatArea.scrollTop = chatArea.scrollHeight;
        return true;
    }
    return false;
}

function clearChatHistory(username) {
    if (username) localStorage.removeItem(chatKey(username));
}
// ===== END CHAT HISTORY =====

function addMessage(text, type) {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = `message-bubble ${type === 'user' ? 'user-msg' : 'bot-msg'}`;
    div.innerHTML = text;
    if (type !== 'user') div.style.color = '#374151';
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
    if (loggedInUser?.username) saveChatHistory(loggedInUser.username);
}

function startSellerPolling() { loadSellerRequests(); sellerInterval = setInterval(loadSellerRequests, 2000); }
function stopSellerPolling() { if (sellerInterval) clearInterval(sellerInterval); }

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
            let firstItemName = req.description;

            if (req.parsed_items) {
                try {
                    const items = JSON.parse(req.parsed_items);
                    if (items.length > 0) {
                        firstItemName = items[0].item.replace(/i want/gi, '').trim();
                    }
                    items.forEach(i => {
                        parsedHTML += `<span style="background:#EFF6FF;color:#1D3557;font-size:0.68rem;font-weight:700;padding:3px 10px;border-radius:20px;border:1.5px solid #BFDBFE;">Qty: ${i.qty}</span>`;
                        totalQty += i.qty;
                    });
                    parsedHTML = `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">${parsedHTML}</div>`;
                } catch (e) { totalQty = 1; }
            }

            const safeItemName = firstItemName.replace(/'/g, "\\'").replace(/"/g, '"');
            const mapLink = req.location ? `https://www.google.com/maps?q=${req.location}` : "#";

            const card = document.createElement('div');
            card.id = `request-${req.id}`;
            card.className = "seller-card";
            card.style.cssText = "margin-bottom:16px; display:block; background:#FFFFFF; border:1px solid rgba(29,53,87,0.1); border-radius:18px; box-shadow:0 2px 16px rgba(29,53,87,0.07); flex-shrink:0;";

            const displayBuyerName = req.buyer_display_name || req.buyer_name || 'Buyer';
            const buyerPhone = (req.buyer_phone || '').replace(/\D/g, '');
            const buyerWaBtn = buyerPhone
                ? `<a href="https://wa.me/${buyerPhone}?text=${encodeURIComponent('Halo, ada pesanan dari Smart Store untuk: ' + req.description)}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:white;font-size:0.68rem;font-weight:700;padding:3px 10px;border-radius:20px;text-decoration:none;"><i class="fab fa-whatsapp"></i> WA Buyer</a>`
                : '';

            card.innerHTML = `
                <div style="padding:16px 18px;border-bottom:1.5px solid rgba(29,53,87,0.07);">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <p style="font-weight:800;color:#1D3557;font-size:0.97rem;line-height:1.4;">“${req.description}”</p>
                            <p style="font-size:0.7rem;color:#9CA3AF;margin-top:4px;">Requested by: <span style="color:#2A9D8F;font-weight:700;">${displayBuyerName}</span> ${buyerWaBtn}</p>
                        </div>
                        ${req.location ? `<a href="${mapLink}" target="_blank" style="color:#2A9D8F;font-size:0.72rem;font-weight:700;white-space:nowrap;display:flex;align-items:center;gap:3px;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"><i class="fas fa-map-marker-alt"></i> Map</a>` : ''}
                    </div>
                    ${parsedHTML}
                </div>
                <div style="padding:16px 18px;">
                <form onsubmit="submitOffer(event, ${req.id}, ${totalQty})" style="display:flex;flex-direction:column;gap:10px;" enctype="multipart/form-data">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <label class="form-label" style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#64748B;font-weight:700;margin-bottom:4px;display:block;">Product Name</label>
                            <input name="product" placeholder="e.g. Nasi Goreng" required style="background:#F8FAFC;border:1.5px solid #E2E8F0;color:#1D3557;padding:10px 14px;border-radius:10px;font-size:0.88rem;width:100%;outline:none;">
                        </div>
                        <div>
                            <label class="form-label" style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#64748B;font-weight:700;margin-bottom:4px;display:block;">Price / portion</label>
                            <div style="position:relative;display:flex;align-items:center;">
                                <input id="price-input-${req.id}" name="unit_price" type="number" placeholder="e.g. 15000" required style="background:#F8FAFC;border:1.5px solid #E2E8F0;color:#1D3557;padding:10px 14px;border-radius:10px;font-size:0.88rem;width:100%;outline:none;padding-right:36px;">
                                <button type="button" onclick="getSmartPrice('${safeItemName}', ${req.id})" style="position:absolute;right:10px;color:#2A9D8F;background:none;border:none;cursor:pointer;font-size:0.9rem;" title="Smart Price">
                                    <i class="fas fa-magic"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div id="price-suggestion-${req.id}" style="display:none; font-size:0.72rem;font-weight:700;color:#2A9D8F;margin-bottom:8px;"></div>
                    
                    <div style="background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:12px;padding:12px;">
                        <label style="font-size:0.68rem;font-weight:700;color:#2A9D8F;text-transform:uppercase;letter-spacing:0.06em;display:flex;align-items:center;gap:5px;margin-bottom:8px;"><i class="fas fa-image"></i> Add Food Photo (optional)</label>
                        <div style="display:flex;gap:8px;">
                            <input type="file" id="gallery-${req.id}" accept="image/*" onchange="previewImage(event, ${req.id}, 'gallery')" style="display:none;">
                            <button type="button" onclick="document.getElementById('gallery-${req.id}').click()" style="flex:1;background:#EFF6FF;color:#1D3557;border:1.5px solid #BFDBFE;border-radius:10px;padding:8px 4px;font-size:0.7rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
                                <i class="fas fa-folder-open"></i> File
                            </button>
                            <button type="button" onclick="startWebcam(${req.id})" style="flex:1;background:#F0FDF4;color:#2A9D8F;border:1.5px solid #A7F3D0;border-radius:10px;padding:8px 4px;font-size:0.7rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
                                <i class="fas fa-laptop"></i> Webcam
                            </button>
                            <input type="hidden" id="use-remote-${req.id}" name="use_remote" value="false">
                            
                            <button type="button" onclick="startPhoneLink(${req.id})" style="flex:1;background:#FAF5FF;color:#7C3AED;border:1.5px solid #DDD6FE;border-radius:10px;padding:8px 4px;font-size:0.7rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
                                <i class="fas fa-mobile-alt"></i> Phone
                            </button>
                        </div>

                        <div id="webcam-container-${req.id}" style="display:none; margin-top:12px; flex-direction:column; gap:8px; align-items:center; background:#EEF2F7; padding:12px; border-radius:10px; border:1.5px solid #A7F3D0;">
                            <video id="webcam-video-${req.id}" autoplay playsinline style="width:100%; aspect-ratio:16/9; background:#000; border-radius:8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></video>
                            <div style="display:flex; gap:8px; width:100%;">
                                <button type="button" onclick="takeSnapshot(${req.id})" style="flex:1; background:#2A9D8F; color:white; padding:10px; border-radius:8px; font-size:0.75rem; font-weight:700; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;"><i class="fas fa-camera"></i> Snap Photo</button>
                                <button type="button" onclick="clearImage(${req.id})" style="flex:1; background:#FEE2E2; color:#E63946; padding:10px; border-radius:8px; font-size:0.75rem; font-weight:700; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;"><i class="fas fa-times"></i> Cancel</button>
                            </div>
                            <canvas id="webcam-canvas-${req.id}" style="display:none;"></canvas>
                        </div>

                        <div id="qr-container-${req.id}" style="display:none; margin-top:12px; flex-direction:column; align-items:center; background:#FAF5FF; padding:16px; border-radius:10px; text-align:center; border:1.5px solid #DDD6FE;">
                            <p style="font-size:0.75rem; color:#7C3AED; font-weight:700; margin-bottom:8px;"><i class="fas fa-qrcode mr-1"></i> Scan to stream camera</p>
                            <div id="qr-img-${req.id}" style="width:136px; height:136px; background:white; border-radius:8px; margin-bottom:12px; display:flex; align-items:center; justify-content:center; padding:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);"></div>
                            <p id="qr-status-${req.id}" style="font-size:0.65rem; color:#6B7280; font-weight:600;"></p>
                            <button type="button" onclick="clearImage(${req.id})" style="margin-top:12px; font-size:0.75rem; color:#EF4444; background:rgba(239,68,68,0.1); padding:6px 16px; border-radius:20px; border:none; cursor:pointer; font-weight:700;">Cancel</button>
                        </div>
                        
                        <div id="image-preview-container-${req.id}" style="display:none; margin-top:12px; position:relative; width:96px; height:96px;">
                            <img id="image-preview-${req.id}" src="" style="width:96px; height:96px; object-fit:cover; border-radius:10px; border:2.5px solid #34D399; box-shadow:0 4px 12px rgba(52,211,153,0.2);">
                            <button type="button" onclick="clearImage(${req.id})" style="position:absolute; top:-8px; right:-8px; background:#EF4444; color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.7rem; border:none; cursor:pointer; box-shadow:0 2px 8px rgba(239,68,68,0.4);"><i class="fas fa-times"></i></button>
                        </div>
                    </div>

                    <button type="submit" style="background:linear-gradient(135deg, #2A9D8F, #21867A); color:white; font-weight:700; border-radius:12px; border:none; width:100%; padding:12px; margin-top:16px; font-size:0.9rem; cursor:pointer; box-shadow:0 4px 12px rgba(42,157,143,0.2);">
                        <i class="fas fa-paper-plane mr-1"></i> Send Offer
                    </button>
                </form>
                </div>`;
            list.prepend(card);
            renderedRequestIds.add(parseInt(req.id));

            const form = card.querySelector('form');
            if (form) showMenuMatchSuggestion(req.id, req.description, form);
        });
    } catch (e) { }
}

async function startWebcam(reqId) {
    clearImage(reqId);
    const container = document.getElementById(`webcam-container-${reqId}`);
    const video = document.getElementById(`webcam-video-${reqId}`);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        webcamStreams[reqId] = stream;

        container.style.display = 'flex';
    } catch (err) {
        alert("Camera access denied or not found. Please allow camera permissions in your browser.");
    }
}

function stopWebcam(reqId) {
    const container = document.getElementById(`webcam-container-${reqId}`);
    const stream = webcamStreams[reqId];
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        delete webcamStreams[reqId];
    }
    if (container) {
        container.style.display = 'none';
    }
}

function takeSnapshot(reqId) {
    const video = document.getElementById(`webcam-video-${reqId}`);
    const canvas = document.getElementById(`webcam-canvas-${reqId}`);
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
        const file = new File([blob], `webcam-snap-${Date.now()}.jpg`, { type: 'image/jpeg' });
        webcamFiles[reqId] = file;

        const previewImg = document.getElementById(`image-preview-${reqId}`);
        const previewContainer = document.getElementById(`image-preview-container-${reqId}`);
        previewImg.src = canvas.toDataURL('image/jpeg');
        previewContainer.style.display = 'inline-block';

        stopWebcam(reqId);

        if (globalPeer) {
            globalPeer.destroy();
            globalPeer = null;
        }
    }, 'image/jpeg', 0.85);
}

async function startPhoneLink(reqId) {
    if (typeof Peer === 'undefined') {
        alert('Phone link feature is not available on this server.\nPlease use "File" to select a photo from your gallery, or "Webcam" to use your device camera.');
        return;
    }
    clearImage(reqId);

    const qrContainer = document.getElementById(`qr-container-${reqId}`);
    const qrImgDiv = document.getElementById(`qr-img-${reqId}`);
    const qrStatus = document.getElementById(`qr-status-${reqId}`);

    qrContainer.style.display = 'flex';
    qrStatus.innerHTML = '<i class="fas fa-spinner fa-spin text-purple-400"></i> Connecting to Video Server...';
    qrImgDiv.innerHTML = "";

    try {
        if (globalPeer) { globalPeer.destroy(); }
        globalPeer = new Peer();

        globalPeer.on('open', (peerId) => {
            const folderPath = window.location.pathname.replace('index.html', '');
            const remoteUrl = `https://${window.location.hostname}${folderPath}remote.html?req=${reqId}&peer=${peerId}`;

            new QRCode(qrImgDiv, {
                text: remoteUrl,
                width: 120, height: 120,
                colorDark: "#000000", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
            });

            qrStatus.innerHTML = '<i class="fas fa-mobile-alt animate-pulse"></i> Waiting for phone camera...';
        });

        globalPeer.on('call', (call) => {
            call.answer();

            call.on('stream', (remoteStream) => {
                qrContainer.style.display = 'none';

                const webcamContainer = document.getElementById(`webcam-container-${reqId}`);
                const videoElement = document.getElementById(`webcam-video-${reqId}`);

                webcamContainer.style.display = 'flex';
                videoElement.srcObject = remoteStream;
            });
        });

        if (remotePolling[reqId]) clearInterval(remotePolling[reqId]);
        remotePolling[reqId] = setInterval(() => checkRemoteUpload(reqId), 1500);

    } catch (err) {
        alert("Failed to connect to the video server.");
        cancelPhoneLink(reqId);
    }
}

function cancelPhoneLink(reqId) {
    const qrContainer = document.getElementById(`qr-container-${reqId}`);
    if (qrContainer) {
        qrContainer.style.display = 'none';
    }
    if (remotePolling[reqId]) clearInterval(remotePolling[reqId]);
    if (globalPeer) { globalPeer.destroy(); globalPeer = null; }
}

async function checkRemoteUpload(reqId) {
    try {
        const res = await fetch(`${API_URL}?action=check_remote&request_id=${reqId}`);
        const data = await res.json();

        if (data.status === 'found') {
            cancelPhoneLink(reqId);
            document.getElementById(`image-preview-${reqId}`).src = data.url;
            document.getElementById(`image-preview-container-${reqId}`).style.display = 'inline-block';
            document.getElementById(`use-remote-${reqId}`).value = 'true';

            stopWebcam(reqId);
        }
    } catch (e) { }
}

function previewImage(event, reqId, source) {
    const file = event.target.files[0];
    const container = document.getElementById(`image-preview-container-${reqId}`);
    const img = document.getElementById(`image-preview-${reqId}`);

    if (source === 'gallery') {
        const remoteInput = document.getElementById(`use-remote-${reqId}`);
        if (remoteInput) remoteInput.value = 'false';
        cancelPhoneLink(reqId);
        delete webcamFiles[reqId];
        stopWebcam(reqId);
    }

    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            img.src = e.target.result;
            container.style.display = 'inline-block';
        }
        reader.readAsDataURL(file);
    } else {
        clearImage(reqId);
    }
}

function clearImage(reqId) {
    const galleryInput = document.getElementById(`gallery-${reqId}`);
    if (galleryInput) galleryInput.value = "";

    delete webcamFiles[reqId];
    stopWebcam(reqId);

    const remoteInput = document.getElementById(`use-remote-${reqId}`);
    if (remoteInput) remoteInput.value = 'false';
    cancelPhoneLink(reqId);

    const previewImg = document.getElementById(`image-preview-${reqId}`);
    const container = document.getElementById(`image-preview-container-${reqId}`);
    if (previewImg) previewImg.src = "";
    if (container) {
        container.style.display = 'none';
    }

    const qrImgDiv = document.getElementById(`qr-img-${reqId}`);
    if (qrImgDiv) qrImgDiv.innerHTML = "";
}

function compressImage(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);

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
                    if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                    else resolve(file);
                }, 'image/jpeg', 0.7);
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
    });
}

async function submitOffer(e, reqId, qty) {
    e.preventDefault();

    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        btn.disabled = true;

        const fd = new FormData(form);
        const unitPrice = parseInt(fd.get('unit_price') || 0);
        const totalPrice = unitPrice * (qty || 1);

        const useRemote = document.getElementById(`use-remote-${reqId}`).value;
        fd.append('use_remote', useRemote);

        let fileToUpload = null;
        const galleryInput = document.getElementById(`gallery-${reqId}`);

        if (useRemote !== 'true') {
            if (webcamFiles && webcamFiles[reqId]) {
                fileToUpload = webcamFiles[reqId];
            } else if (galleryInput && galleryInput.files.length > 0) {
                fileToUpload = galleryInput.files[0];
            }
        }

        if (fileToUpload) {
            const compressedFile = await compressImage(fileToUpload);
            fd.set('food_image', compressedFile);
        } else {
            fd.delete('food_image');
        }

        fd.append('action', 'add_offer');
        fd.append('request_id', reqId);
        fd.append('seller_name', loggedInUser.username);
        fd.append('product_name', fd.get('product'));
        fd.set('price', totalPrice);

        const res = await fetch(API_URL, { method: 'POST', body: fd });
        const text = await res.text();

        try {
            const data = JSON.parse(text);
            if (data.error) { alert("Database Error: " + data.error); }
            if (data.upload_error) { alert("Image Error: " + data.upload_error); }

            clearImage(reqId);
            form.reset();

            const card = document.getElementById(`request-${reqId}`);
            if (card) {
                const toast = document.createElement('div');
                toast.style.cssText = `
                    background:linear-gradient(135deg,#2A9D8F,#21867A);
                    border-radius:12px;padding:12px 16px;text-align:center;
                    margin-bottom:8px;transition:opacity 0.5s;`;
                toast.innerHTML = `
                    <div style="color:white;font-weight:800;font-size:0.95rem;margin-bottom:2px;">
                        <i class="fas fa-check-circle"></i> Offer Sent!
                    </div>
                    <div style="color:rgba(255,255,255,0.9);font-size:0.82rem;">
                        Total: <strong>Rp ${parseInt(totalPrice).toLocaleString('id-ID')}</strong>
                    </div>
                    <div style="color:rgba(255,255,255,0.7);font-size:0.72rem;margin-top:3px;">
                        <i class="fas fa-clock"></i> Waiting for buyer · you can send another offer below
                    </div>`;

                const formWrapper = card.querySelector('form');
                if (formWrapper) formWrapper.parentNode.insertBefore(toast, formWrapper);

                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => toast.remove(), 500);
                }, 4000);
            }

        } catch (jsonErr) {
            console.error("RAW PHP ERROR:", text);
            alert("PHP Error: Press F12 and check the Console.");
        }
    } catch (err) {
        alert("An error occurred: " + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="text-center text-emerald-400 mt-10"><i class="fas fa-spinner fa-spin text-3xl"></i></div>';

    const res = await fetch(`${API_URL}?action=get_orders&username=${loggedInUser.username}&role=${activeRole}`);
    const orders = await res.json();

    list.innerHTML = orders.map(order => {
        const date = new Date(order.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
        const imgTag = order.image_path ? `<img src="${order.image_path}" style="width:68px;height:68px;object-fit:cover;border-radius:12px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,0.1);">` : '';

        const oppositePerson = activeRole === 'buyer'
            ? `<i class="fas fa-store mr-1"></i>${order.seller_name}`
            : `<i class="fas fa-shopping-bag mr-1"></i>${order.buyer_name}`;

        let statusChip = '';
        let cardBorder = '#E5E7EB';
        let cardBg = '#FFFFFF';
        if (order.status === 'pending') {
            statusChip = `<span style="background:#FEF3C7;color:#92400E;border:1.5px solid #FCD34D;font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.06em;"><i class="fas fa-clock mr-1"></i>Pending</span>`;
            cardBorder = '#FCD34D'; cardBg = '#FFFDF0';
        } else if (order.status === 'rejected') {
            statusChip = `<span style="background:#FEE2E2;color:#991B1B;border:1.5px solid #F87171;font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.06em;"><i class="fas fa-xmark mr-1"></i>Rejected</span>`;
            cardBorder = '#F87171'; cardBg = '#FFF5F5';
        } else {
            statusChip = `<span style="background:#D1FAE5;color:#065F46;border:1.5px solid #34D399;font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.06em;"><i class="fas fa-check mr-1"></i>Completed</span>`;
            cardBorder = '#34D399'; cardBg = '#F0FDF4';
        }

        const pmMap = { balance: { label: 'Wallet', icon: 'fas fa-wallet', color: '#2A9D8F' }, qris: { label: 'QRIS', icon: 'fas fa-qrcode', color: '#7C3AED' }, cash: { label: 'Cash/Transfer', icon: 'fas fa-money-bill-wave', color: '#D97706' } };
        const pm = pmMap[order.payment_method] || pmMap['cash'];
        const payBadge = `<span style="color:${pm.color};font-size:0.68rem;font-weight:700;"><i class="${pm.icon} mr-1"></i>${pm.label}</span>`;

        let actionButtons = '';
        if (activeRole === 'seller' && order.status === 'pending') {
            const bPhone = (order.buyer_phone || '').replace(/\D/g,'');
            const waLink = bPhone ? `<a href="https://wa.me/${bPhone}?text=${encodeURIComponent('Halo, pesanan Smart Store kamu sudah kami terima!')}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;background:#25D366;color:white;font-size:0.78rem;font-weight:700;padding:9px 14px;border-radius:11px;text-decoration:none;"><i class="fab fa-whatsapp"></i> WA Buyer</a>` : '';
            actionButtons = `
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                    ${waLink}
                    <button onclick="verifyOrder(${order.id}, 'completed', this)" style="flex:1;min-width:100px;background:#2A9D8F;color:white;font-size:0.78rem;font-weight:800;padding:10px;border-radius:11px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;"><i class="fas fa-check"></i>Approve Order</button>
                    <button onclick="verifyOrder(${order.id}, 'rejected', this)" style="background:#FEE2E2;color:#E63946;font-size:0.78rem;font-weight:800;padding:10px 12px;border-radius:11px;border:1.5px solid #F87171;cursor:pointer;display:flex;align-items:center;gap:5px;"><i class="fas fa-xmark"></i>Reject</button>
                </div>`;
        } else if (activeRole === 'buyer' && order.status === 'pending') {
            actionButtons = `<div style="margin-top:10px;background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:10px;padding:8px;text-align:center;font-size:0.72rem;font-weight:700;color:#1D4ED8;"><i class="fas fa-hourglass-half mr-1"></i>Waiting for seller to verify your payment...</div>`;
        } else if (activeRole === 'buyer' && order.status === 'rejected') {
            actionButtons = `<div style="margin-top:10px;background:#FEE2E2;border:1.5px solid #F87171;border-radius:10px;padding:8px;text-align:center;font-size:0.72rem;font-weight:700;color:#991B1B;"><i class="fas fa-triangle-exclamation mr-1"></i>Payment was rejected by the seller. Please contact them.</div>`;
        }

        return `
        <div style="background:${cardBg};border:1.5px solid ${cardBorder};border-radius:18px;padding:14px;box-shadow:0 2px 12px rgba(0,0,0,0.06);transition:box-shadow 0.2s; flex-shrink:0; margin-bottom: 12px;">
            <div style="display:flex;align-items:flex-start;gap:12px;">
                ${imgTag}
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
                        <div style="font-weight:800;color:#1D3557;font-size:0.95rem;">${order.product_name}</div>
                        ${statusChip}
                    </div>
                    <div style="font-size:0.72rem;color:#6B7280;margin-top:3px;">${oppositePerson}</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;flex-wrap:wrap;gap:4px;">
                        <div style="font-size:1rem;font-weight:900;color:#F4A261;">Rp ${parseInt(order.total_price).toLocaleString('id-ID')}</div>
                        ${payBadge}
                    </div>
                    <div style="font-size:0.65rem;color:#9CA3AF;margin-top:3px;"><i class="fas fa-calendar-alt mr-1"></i>${date}</div>
                </div>
            </div>
            ${actionButtons}
        </div>`;
    }).join('');

    if (!orders.length) {
        list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#9CA3AF;"><i class="fas fa-receipt" style="font-size:2.5rem;display:block;margin-bottom:12px;opacity:0.5;"></i>No orders yet.</div>`;
    }
}

async function verifyOrder(orderId, status, btnElement) {
    const actionText = status === 'completed' ? 'Approve' : 'Reject';
    if (!confirm(`${actionText} this order?`)) return;

    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btnElement.disabled = true;

    const fd = new FormData();
    fd.append('action', 'verify_order');
    fd.append('order_id', orderId);
    fd.append('seller_name', loggedInUser.username);
    fd.append('verification_status', status);

    try {
        await fetch(API_URL, { method: 'POST', body: fd });
        const card = btnElement.closest('[style*="border-radius:18px"]');
        if (card) {
            card.style.transition = 'opacity 0.3s';
            card.style.opacity = '0';
            setTimeout(() => card.remove(), 300);
        } else {
            loadHistory();
        }
    } catch (e) {
        alert("Network Error.");
        btnElement.innerHTML = originalHtml;
        btnElement.disabled = false;
    }
}

async function getSmartPrice(itemName, reqId) {
    const suggestionBox = document.getElementById(`price-suggestion-${reqId}`);
    const priceInput = document.getElementById(`price-input-${reqId}`);
    const icon = priceInput.nextElementSibling.querySelector('i');

    icon.classList.remove('fa-magic');
    icon.classList.add('fa-spinner', 'fa-spin');

    try {
        const keyword = itemName.split(' ')[0];
        const res = await fetch(`${API_URL}?action=suggest_price&item=${encodeURIComponent(keyword)}`);
        const data = await res.json();

        suggestionBox.style.display = 'block';
        if (data.price) {
            suggestionBox.innerHTML = `<i class="fas fa-chart-line"></i> Market avg: Rp ${data.price.toLocaleString()} <button type="button" onclick="document.getElementById('price-input-${reqId}').value = ${data.price}; this.parentElement.style.display = 'none';" class="ml-1 underline hover:text-white">Use this</button>`;
        } else {
            suggestionBox.innerHTML = `<i class="fas fa-info-circle"></i> No past data for "${keyword}" yet.`;
            setTimeout(() => suggestionBox.style.display = 'none', 3000);
        }
    } catch (e) {
    } finally {
        icon.classList.remove('fa-spinner', 'fa-spin');
        icon.classList.add('fa-magic');
    }
}

function openMenuManager() {
    const modal = document.getElementById('menu-modal');
    modal.classList.remove('ss-hidden');
    renderMenuList();
}

function closeMenuManager() {
    const modal = document.getElementById('menu-modal');
    modal.classList.add('ss-hidden');
}

function getSellerMenu() {
    const s = localStorage.getItem('smartstore_menu_' + (loggedInUser?.username || ''));
    return s ? JSON.parse(s) : [];
}

function saveSellerMenu(items) {
    localStorage.setItem('smartstore_menu_' + (loggedInUser?.username || ''), JSON.stringify(items));
}

function addMenuItem() {
    const nameEl = document.getElementById('menu-item-name');
    const priceEl = document.getElementById('menu-item-price');
    const name = nameEl.value.trim();
    const price = parseInt(priceEl.value || 0);
    if (!name) { nameEl.focus(); return; }
    const items = getSellerMenu();
    items.push({ id: Date.now(), name, price });
    saveSellerMenu(items);
    nameEl.value = ''; priceEl.value = '';
    renderMenuList();
}

function removeMenuItem(id) {
    const items = getSellerMenu().filter(i => i.id !== id);
    saveSellerMenu(items);
    renderMenuList();
}

function renderMenuList() {
    const list = document.getElementById('menu-list');
    const empty = document.getElementById('menu-empty');
    const items = getSellerMenu();
    if (!items.length) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    list.innerHTML = items.map(item => `
        <div style="background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:12px;padding:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div>
                <div style="font-weight:700;color:#1D3557;font-size:0.88rem;">${item.name}</div>
                <div style="font-size:0.75rem;color:#2A9D8F;font-weight:700;">Rp ${parseInt(item.price || 0).toLocaleString('id-ID')}</div>
            </div>
            <button onclick="removeMenuItem(${item.id})" style="background:#FEE2E2;color:#E63946;border:none;border-radius:8px;padding:6px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;"><i class="fas fa-trash"></i></button>
        </div>`).join('');
}

// 🌟 FIX: Much stricter AI match logic so Nasi Padang does not match Nasi Goreng
function checkMenuMatch(requestDescription) {
    const menu = getSellerMenu();
    if (!menu.length) return null;
    
    const desc = requestDescription.toLowerCase();
    
    // Remove common prefixes so we only match the actual food name
    let cleanDesc = desc.replace(/i want to eat |i want to buy |i want |buy |pesan |beli |order /gi, '').trim();

    const matches = menu.filter(item => {
        const itemName = item.name.toLowerCase();
        
        // 1. Direct inclusion (e.g. buyer says "nasi goreng", item is "nasi goreng spesial")
        if (desc.includes(itemName) || (cleanDesc.length > 2 && itemName.includes(cleanDesc))) {
            return true;
        }
        
        // 2. Strict word overlap check
        // Prevents "Nasi" from returning true when item is "Nasi Goreng" 
        const itemWords = itemName.split(/\s+/).filter(w => w.length > 2);
        if (itemWords.length > 0) {
            // EVERY significant word in the menu item MUST be present in the buyer's request
            const allWordsMatch = itemWords.every(w => desc.includes(w));
            if (allWordsMatch) return true;
        }
        
        return false;
    });
    
    return matches.length ? matches : null;
}

function showMenuMatchSuggestion(reqId, requestDescription, formEl) {
    const matches = checkMenuMatch(requestDescription);
    if (!matches) return;
    const existing = document.getElementById(`menu-match-${reqId}`);
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = `menu-match-${reqId}`;
    banner.style.cssText = 'background:linear-gradient(135deg,#EFF6FF,#DBEAFE);border:1.5px solid #93C5FD;border-radius:12px;padding:12px;margin-bottom:10px;';
    banner.innerHTML = `
        <p style="font-size:0.72rem;font-weight:700;color:#1D4ED8;margin-bottom:6px;"><i class="fas fa-robot mr-1"></i>AI Match — Your menu has what they want!</p>
        ${matches.map(m => `<button type="button" onclick="applyMenuMatch(${reqId}, '${m.name.replace(/'/g,"\\'")}', ${m.price})"
            style="background:#2563EB;color:white;font-size:0.72rem;font-weight:700;padding:4px 10px;border-radius:20px;border:none;cursor:pointer;margin:2px;display:inline-flex;align-items:center;gap:4px;">
            <i class="fas fa-bolt"></i> Use: ${m.name} (Rp ${parseInt(m.price).toLocaleString('id-ID')})
        </button>`).join('')}`;
    formEl.insertBefore(banner, formEl.firstChild);
}

function applyMenuMatch(reqId, name, price) {
    const productInput = document.querySelector(`#request-${reqId} [name="product"]`);
    const priceInput = document.getElementById(`price-input-${reqId}`);
    if (productInput) productInput.value = name;
    if (priceInput) priceInput.value = price;
}