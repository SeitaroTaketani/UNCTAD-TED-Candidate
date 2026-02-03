// Configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// State
let candidates = [];
let currentIndex = -1;
let history = [];
let textExtractionQueue = [];
let isExtracting = false;

// DOM Elements
const pdfInput = document.getElementById('pdf-input');
const candidateListEl = document.getElementById('candidate-list');
const cardContainer = document.getElementById('card-container');
const searchIdInput = document.getElementById('search-id');
const searchKeywordInput = document.getElementById('search-keyword');
const indexingStatusEl = document.getElementById('indexing-status');
const filterInfoEl = document.getElementById('filter-info');
const downloadBtn = document.getElementById('download-btn');
const keptCountEl = document.getElementById('kept-count');
const totalCountEl = document.getElementById('total-count');
// 追加: ラジオボタンの要素を取得
const regionRadios = document.getElementsByName('region-filter');

// --- Event Listeners ---

pdfInput.addEventListener('change', handleFiles);

// Drag & Drop
const body = document.body;
['dragenter', 'dragover'].forEach(evt => {
    body.addEventListener(evt, e => { e.preventDefault(); body.classList.add('drag-active'); });
});
['dragleave', 'drop'].forEach(evt => {
    body.addEventListener(evt, e => { e.preventDefault(); body.classList.remove('drag-active'); });
});
body.addEventListener('drop', e => {
    handleFiles(e);
});

// Search Inputs
searchIdInput.addEventListener('input', renderList);
searchKeywordInput.addEventListener('input', () => {
    renderList();
    if (currentIndex !== -1) {
        selectCandidate(currentIndex); 
    }
});

// 追加: ラジオボタン変更時のイベントリスナー
regionRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        renderList();
        // 現在表示中の候補がフィルタで消える場合などの処理はここに追加可能
    });
});

// Keyboard Shortcuts
document.addEventListener('keydown', e => {
    if (document.activeElement === searchIdInput || document.activeElement === searchKeywordInput) return;
    if (candidates.length === 0 || currentIndex === -1) return;

    if (e.key === 'ArrowRight') judgeCandidate('kept');
    if (e.key === 'ArrowLeft') judgeCandidate('rejected');
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') undoLastAction();
});

downloadBtn.addEventListener('click', downloadZip);


// --- Core Functions ---

async function handleFiles(e) {
    const files = e.target.files || e.dataTransfer.files;
    if (!files.length) return;

    const newFiles = Array.from(files).filter(f => f.type === 'application/pdf');
    if (newFiles.length === 0) return;

    for (const file of newFiles) {
        const phpId = file.name.replace(/\.[^/.]+$/, "");
        if (!candidates.some(c => c.id === phpId)) {
            const newCandidate = {
                id: phpId,
                file: file,
                status: 'pending',
                fullText: null, 
                matchCount: 0,
                region: null // 追加: 地域の初期値
            };
            candidates.push(newCandidate);
            textExtractionQueue.push(newCandidate);
        }
    }

    if(e.target.value) e.target.value = '';
    totalCountEl.innerText = candidates.length;
    renderList();
    processTextExtractionQueue();

    if (currentIndex === -1) {
        selectNextPending();
    }
}

// --- Background Text Extraction ---
async function processTextExtractionQueue() {
    if (isExtracting) return;
    isExtracting = true;

    while (textExtractionQueue.length > 0) {
        const candidate = textExtractionQueue.shift();
        const remaining = textExtractionQueue.length;
        indexingStatusEl.innerText = `Indexing... ${candidates.length - remaining}/${candidates.length}`;

        try {
            const text = await extractTextFromPdf(candidate.file);
            candidate.fullText = text.toLowerCase();
            
            // 追加: 住所判定を実行 (country-filters.jsの関数を使用)
            // 最初の1500文字程度で住所判定を行う
            const firstPageText = text.substring(0, 1500);
            if (typeof determineRegion === 'function') {
                candidate.region = determineRegion(firstPageText);
            } else {
                console.warn('determineRegion function not found. Check country-filters.js');
                candidate.region = 'Others';
            }

        } catch (err) {
            console.error("Extraction error", err);
            candidate.fullText = "";
            candidate.region = "Others";
        }
        
        // リアルタイムでリスト更新
        if(searchKeywordInput.value.length > 0 || document.querySelector('input[name="region-filter"]:checked').value !== 'All') {
            renderList();
        }
    }

    indexingStatusEl.innerText = "Indexing complete";
    setTimeout(() => { indexingStatusEl.innerText = ""; }, 3000);
    isExtracting = false;
}

async function extractTextFromPdf(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + " ";
    }
    return fullText;
}

// --- Helper: Get Keywords ---
function getKeywords() {
    const raw = searchKeywordInput.value.trim();
    if (!raw) return [];
    return raw.toLowerCase().split(/[\s,]+/).filter(k => k.length > 0);
}

// --- Helper: Check if candidate matches filter (修正済み) ---
function isCandidateVisible(candidate) {
    // 1. ID Filter
    const idTerm = searchIdInput.value.toLowerCase();
    if (!candidate.id.toLowerCase().includes(idTerm)) return false;

    // 2. Region Filter (ここを追加・修正)
    let selectedRegion = 'All';
    for (const radio of regionRadios) {
        if (radio.checked) {
            selectedRegion = radio.value;
            break;
        }
    }

    if (selectedRegion !== 'All') {
        // まだ解析中の場合は表示しない、もしくは解析されるまで待つ
        if (!candidate.region) return false; 
        if (candidate.region !== selectedRegion) return false;
    }

    // 3. Keyword Filter
    const keywords = getKeywords();
    if (keywords.length === 0) return true;

    if (!candidate.fullText) return true;

    let matches = 0;
    keywords.forEach(kw => {
        const regex = new RegExp(escapeRegExp(kw), "g");
        if (candidate.fullText.match(regex)) matches++;
    });

    return matches > 0;
}

// --- UI Rendering ---

function renderList() {
    candidateListEl.innerHTML = '';
    const keywords = getKeywords();

    const filteredCandidates = candidates.map((c, index) => {
        if (!isCandidateVisible(c)) return null;

        let matches = 0;
        if (keywords.length > 0 && c.fullText) {
            keywords.forEach(kw => {
                const regex = new RegExp(escapeRegExp(kw), "g");
                const found = c.fullText.match(regex);
                if (found) matches += found.length;
            });
        }

        return { original: c, index: index, matches: matches };
    }).filter(item => item !== null);

    // Update Filter Info Bar
    let filterText = [];
    // 地域フィルタの表示
    const selectedRadio = Array.from(regionRadios).find(r => r.checked);
    if (selectedRadio && selectedRadio.value !== 'All') {
        filterText.push(`Region: ${selectedRadio.value}`);
    }
    // キーワードフィルタの表示
    if (keywords.length > 0) {
        filterText.push(`Keywords: "${keywords.join(', ')}"`);
    }

    if (filterText.length > 0) {
        filterInfoEl.innerText = `Filtering by ${filterText.join(' & ')} - ${filteredCandidates.length} matches`;
        filterInfoEl.classList.add('visible');
    } else {
        filterInfoEl.classList.remove('visible');
    }

    filteredCandidates.forEach(item => {
        const c = item.original;
        const index = item.index;

        const li = document.createElement('li');
        li.className = `list-item ${index === currentIndex ? 'active' : ''}`;
        li.onclick = () => selectCandidate(index);

        let iconClass = 'fas fa-circle status-pending';
        if (c.status === 'kept') iconClass = 'fas fa-check-circle status-keep';
        if (c.status === 'rejected') iconClass = 'fas fa-times-circle status-reject';

        const badgeDisplay = item.matches > 0 ? `visible` : ``;
        const badgeText = item.matches > 99 ? "99+" : item.matches;
        
        // 地域タグの表示 (オプション)
        const regionTag = (c.region && c.region !== 'Others') ? `<span style="font-size:0.7em; background:#eee; color:#555; padding:1px 4px; border-radius:3px; margin-right:5px;">${c.region}</span>` : '';

        li.innerHTML = `
            <span>${regionTag}${c.id}</span>
            <div class="meta-info">
                <span class="match-badge ${badgeDisplay}">${badgeText} hits</span>
                <i class="${iconClass} status-icon"></i>
            </div>
        `;
        candidateListEl.appendChild(li);
    });

    updateStats();
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateStats() {
    const kept = candidates.filter(c => c.status === 'kept').length;
    keptCountEl.innerText = kept;
    downloadBtn.disabled = kept === 0;
}

// --- PDF Viewer & Highlighting ---

async function selectCandidate(index) {
    if (index < 0 || index >= candidates.length) return;
    currentIndex = index;
    
    // UI更新 (リストの再描画はちらつくのでクラスだけ操作したいが、フィルタ時はリストが変わるのでrenderList推奨)
    renderList(); 
    
    const candidate = candidates[index];
    
    cardContainer.innerHTML = `
        <div class="info-overlay"><i class="fas fa-id-badge"></i> ${candidate.id}</div>
        <button class="control-btn btn-undo" onclick="undoLastAction()" title="Undo"><i class="fas fa-undo"></i></button>
        
        <div class="pdf-viewer" id="pdf-viewer-content">
            <div style="margin:auto; color:#666; font-size:1.2rem;">
                <i class="fas fa-spinner fa-spin"></i> Loading PDF...
            </div>
        </div>
        
        <div class="keyboard-hint">⬅️ Reject &nbsp;|&nbsp; Keep ➡️</div>
        
        <div class="card-controls">
            <button class="control-btn btn-reject" onclick="judgeCandidate('rejected')"><i class="fas fa-times"></i></button>
            <button class="control-btn btn-keep" onclick="judgeCandidate('kept')"><i class="fas fa-check"></i></button>
        </div>
    `;

    await renderPdfWithHighlights(candidate.file);
}

async function renderPdfWithHighlights(file) {
    const viewer = document.getElementById('pdf-viewer-content');
    if (!viewer) return;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
        
        viewer.innerHTML = ''; 
        const containerWidth = viewer.clientWidth - 60; 
        const keywords = getKeywords(); 

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            
            // Scaling
            const unscaledViewport = page.getViewport({scale: 1});
            const scale = containerWidth / unscaledViewport.width;
            const viewport = page.getViewport({scale: scale});
            
            // Wrapper
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'pdf-page-wrapper';
            pageWrapper.style.width = `${viewport.width}px`;
            pageWrapper.style.height = `${viewport.height}px`;
            viewer.appendChild(pageWrapper);

            // Canvas
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            const context = canvas.getContext('2d');
            
            const outputScale = window.devicePixelRatio || 1;
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = '100%';
            canvas.style.height = '100%';

            pageWrapper.appendChild(canvas);

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                transform: [outputScale, 0, 0, outputScale, 0, 0]
            };
            
            await page.render(renderContext).promise;

            // Text Layer
            const textContent = await page.getTextContent();
            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'textLayer';
            textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
            
            pageWrapper.appendChild(textLayerDiv);

            await pdfjsLib.renderTextLayer({
                textContent: textContent,
                container: textLayerDiv,
                viewport: viewport,
                textDivs: []
            }).promise;

            // Highlights
            if (keywords.length > 0) {
                highlightMatchesInTextLayer(textLayerDiv, keywords);
            }
        }
    } catch (err) {
        console.error(err);
        if(viewer) viewer.innerHTML = `<div style="color:red; margin:auto;">Error loading PDF.</div>`;
    }
}

function highlightMatchesInTextLayer(textLayerDiv, keywords) {
    const children = Array.from(textLayerDiv.children);
    children.forEach(span => {
        let html = span.innerHTML;
        let modified = false;
        keywords.forEach(kw => {
            const regex = new RegExp(`(${escapeRegExp(kw)})`, 'gi');
            if (regex.test(html)) {
                html = html.replace(regex, '<span class="highlight">$1</span>');
                modified = true;
            }
        });
        if (modified) span.innerHTML = html;
    });
}

// --- Logic Actions ---

function judgeCandidate(status) {
    if (currentIndex === -1) return;

    history.push({
        index: currentIndex,
        prevStatus: candidates[currentIndex].status
    });

    candidates[currentIndex].status = status;
    selectNextPending();
}

function selectNextPending() {
    let searchStart = currentIndex + 1;
    let foundIndex = -1;

    // Forward search
    for (let i = searchStart; i < candidates.length; i++) {
        if (candidates[i].status === 'pending' && isCandidateVisible(candidates[i])) {
            foundIndex = i;
            break;
        }
    }

    // Loop search
    if (foundIndex === -1) {
        for (let i = 0; i < searchStart; i++) {
            if (candidates[i].status === 'pending' && isCandidateVisible(candidates[i])) {
                foundIndex = i;
                break;
            }
        }
    }

    if (foundIndex !== -1) {
        selectCandidate(foundIndex);
    } else {
        renderList();
        const keywords = getKeywords();
        const selectedRadio = Array.from(regionRadios).find(r => r.checked);
        
        if (keywords.length > 0 || (selectedRadio && selectedRadio.value !== 'All')) {
            alert(`No more pending candidates matching filter.`);
        } else {
            alert("All candidates screened!");
        }
    }
}

function undoLastAction() {
    if (history.length === 0) return;
    const lastAction = history.pop();
    candidates[lastAction.index].status = lastAction.prevStatus;
    selectCandidate(lastAction.index);
}

// --- ZIP Download ---

async function downloadZip() {
    const keptCandidates = candidates.filter(c => c.status === 'kept');
    if (keptCandidates.length === 0) return;

    const zip = new JSZip();
    const originalText = downloadBtn.innerHTML;
    downloadBtn.innerText = "Compressing...";
    downloadBtn.disabled = true;

    try {
        const folder = zip.folder("Selected_Candidates");
        for (const c of keptCandidates) {
            folder.file(c.file.name, c.file);
        }

        const content = await zip.generateAsync({type: "blob"});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = "UNCTAD_Selection.zip";
        link.click();
        
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
    } catch (err) {
        console.error(err);
        alert("Error creating ZIP.");
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
    }
}