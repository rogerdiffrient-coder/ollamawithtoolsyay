const OLLAMA = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-chat-state-v3';
const MEMORY_INDEX_KEY = 'ollama-semantic-memory-v1';
const MEMORY_VERSION = 2;

const $ = (selector) => document.querySelector(selector);
const modelSelect = $('#model');
const statusEl = $('#status');
const chatEl = $('#chat');
const form = $('#form');
const input = $('#input');
const sendButton = $('#send');
const chatListEl = $('#chatList');
const chatTitleEl = $('#chatTitle');
const searchEl = $('#chatSearch');
const memoryStatusEl = $('#memoryStatus');
const sidebar = $('#sidebar');
const mobileOverlay = $('#mobileOverlay');

const REMEMBER_TOOL = {
  type: 'function',
  function: {
    name: 'remember',
    description: 'Search persistent conversation memory when the user asks about older messages, another chat, a past decision, a forgotten detail, project history, preferences, names, or something not present in the current context. Do NOT use this for greetings, casual conversation, or questions you can answer from the current conversation. Never call this tool with an empty query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A specific natural-language description of the older information you need to recall. Must not be empty.' },
        chat_id: { type: 'string', description: 'Optional chat ID to restrict the search.' }
      },
      required: ['query']
    }
  }
};

let state = loadState();
let memoryIndex = loadMemoryIndex();
let isGenerating = false;

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.version === MEMORY_VERSION && Array.isArray(saved.chats)) return saved;
  } catch (error) { console.warn('Could not load saved chats:', error); }
  return { version: MEMORY_VERSION, activeChatId: null, chats: [] };
}

function loadMemoryIndex() {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMORY_INDEX_KEY));
    if (saved?.version === 1 && Array.isArray(saved.items)) return saved;
  } catch (error) { console.warn('Could not load semantic memory index:', error); }
  return { version: 1, items: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateMemoryStatus();
}

function saveMemoryIndex() {
  try { localStorage.setItem(MEMORY_INDEX_KEY, JSON.stringify(memoryIndex)); }
  catch (error) { console.warn('Memory index is too large for localStorage:', error); }
}

function createChat() {
  const chat = { id: uid(), title: 'New chat', model: modelSelect.value || '', messages: [], summary: '', updatedAt: Date.now() };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  saveState(); renderChatList(); renderActiveChat(); closeMobileSidebar(); input.focus();
  return chat;
}

function getActiveChat() { return state.chats.find(chat => chat.id === state.activeChatId) || null; }
function ensureActiveChat() { return getActiveChat() || createChat(); }

function deleteChat(id) {
  state.chats = state.chats.filter(chat => chat.id !== id);
  memoryIndex.items = memoryIndex.items.filter(item => item.chatId !== id);
  if (state.activeChatId === id) state.activeChatId = state.chats[0]?.id || null;
  saveState(); saveMemoryIndex(); renderChatList(); renderActiveChat();
}

function selectChat(id) {
  if (isGenerating) return;
  state.activeChatId = id; saveState(); renderChatList(); renderActiveChat(); closeMobileSidebar();
}

function formatDate(timestamp) {
  const date = new Date(timestamp), today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderChatList() {
  const query = searchEl.value.trim().toLowerCase();
  chatListEl.innerHTML = '';
  const chats = state.chats.filter(chat => !query || `${chat.title} ${chat.summary} ${chat.messages.map(m => m.content || '').join(' ')}`.toLowerCase().includes(query));
  if (!chats.length) {
    const empty = document.createElement('div'); empty.className = 'chat-item-meta'; empty.style.padding = '10px';
    empty.textContent = query ? 'No matching chats' : 'No chats yet'; chatListEl.appendChild(empty); return;
  }
  for (const chat of chats) {
    const item = document.createElement('button'); item.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`; item.type = 'button';
    item.innerHTML = '<div class="chat-item-title"></div><div class="chat-item-meta"></div><span class="delete-chat" title="Delete chat">×</span>';
    item.querySelector('.chat-item-title').textContent = chat.title || 'New chat';
    item.querySelector('.chat-item-meta').textContent = chat.messages.length ? formatDate(chat.updatedAt) : 'Empty';
    item.addEventListener('click', event => {
      if (event.target.classList.contains('delete-chat')) { event.stopPropagation(); deleteChat(chat.id); return; }
      selectChat(chat.id);
    });
    chatListEl.appendChild(item);
  }
}

function renderActiveChat() {
  const chat = getActiveChat(); chatEl.innerHTML = '';
  if (!chat || !chat.messages.length) {
    const welcome = document.createElement('div'); welcome.className = 'welcome';
    welcome.innerHTML = '<div class="welcome-icon">✦</div><h1>What are we building?</h1><p>Your local AI, with persistent chats and searchable memory.</p><div class="feature-row"><span>⌘ Local</span><span>◷ History</span><span>◈ Memory</span></div>';
    chatEl.appendChild(welcome); chatTitleEl.textContent = chat?.title || 'New chat'; return;
  }
  chatTitleEl.textContent = chat.title;
  for (const message of chat.messages) if (message.role !== 'system' && message.role !== 'tool') addMessageElement(message.role, message.content || '', message.thinking || '');
  scrollToBottom();
}

function addMessageElement(role, text = '', thinking = '') {
  const wrapper = document.createElement('div'); wrapper.className = `message ${role}`;
  const row = document.createElement('div'); row.className = 'message-row';
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = role === 'user' ? 'Y' : '✦';
  const content = document.createElement('div'); content.className = 'message-content';
  const roleLabel = document.createElement('div'); roleLabel.className = 'role'; roleLabel.textContent = role === 'user' ? 'You' : 'AI';

  if (role === 'assistant' && thinking) {
    const details = document.createElement('details'); details.className = 'thinking-block';
    const summary = document.createElement('summary'); summary.textContent = 'Thinking';
    const thought = document.createElement('div'); thought.className = 'thinking-content'; thought.textContent = thinking;
    details.append(summary, thought); content.appendChild(details);
  }

  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
  content.append(roleLabel, bubble); row.append(avatar, content); wrapper.appendChild(row); chatEl.appendChild(wrapper); return { bubble, content };
}

function setThinkingElement(content, thinking) {
  if (!thinking) return;
  let details = content.querySelector('.thinking-block');
  if (!details) {
    details = document.createElement('details'); details.className = 'thinking-block';
    const summary = document.createElement('summary'); summary.textContent = 'Thinking';
    const thought = document.createElement('div'); thought.className = 'thinking-content'; details.append(summary, thought); content.insertBefore(details, content.querySelector('.bubble'));
  }
  details.querySelector('.thinking-content').textContent = thinking;
}

function scrollToBottom() { chatEl.scrollTop = chatEl.scrollHeight; }
function closeMobileSidebar() { sidebar.classList.remove('open'); mobileOverlay.classList.remove('open'); }

function updateMemoryStatus() {
  const total = state.chats.reduce((sum, chat) => sum + chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').length, 0);
  memoryStatusEl.textContent = `${state.chats.length} chat${state.chats.length === 1 ? '' : 's'} · ${total} messages · ${memoryIndex.items.length} semantic memories`;
}

async function loadModels() {
  statusEl.textContent = 'Connecting to Ollama…'; statusEl.className = '';
  try {
    const response = await fetch(`${OLLAMA}/api/tags`); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(), models = data.models || []; modelSelect.innerHTML = '';
    if (!models.length) { modelSelect.innerHTML = '<option value="">No models installed</option>'; modelSelect.disabled = true; statusEl.textContent = 'No models found'; return; }
    for (const model of models) { const option = document.createElement('option'); option.value = model.name; option.textContent = model.name; modelSelect.appendChild(option); }
    const active = getActiveChat(); if (active?.model && models.some(m => m.name === active.model)) modelSelect.value = active.model;
    modelSelect.disabled = false; statusEl.textContent = `${models.length} model${models.length === 1 ? '' : 's'} ready`;
  } catch (error) { modelSelect.innerHTML = '<option value="">Ollama unavailable</option>'; modelSelect.disabled = true; statusEl.textContent = 'Can’t connect to Ollama'; statusEl.className = 'error'; console.error(error); }
}

function titleFromFirstMessage(text) { const clean = text.replace(/\s+/g, ' ').trim(); return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || 'New chat'; }
function formatMemoryMessage(message) { return `[${message.role === 'user' ? 'Human' : 'AI'}] ${message.content}`; }

function getMemoryContext(chat) {
  const conversational = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const humans = conversational.filter(m => m.role === 'user').slice(-5);
  const assistants = conversational.filter(m => m.role === 'assistant').slice(-5);
  const recent = conversational.slice(-10);
  const older = conversational.slice(0, Math.max(0, conversational.length - 10));
  const parts = [];
  if (chat.summary) parts.push(`CURRENT CHAT OLDER-MESSAGE SUMMARY:\n${chat.summary}`);
  if (older.length && !chat.summary) parts.push(`OLDER CURRENT-CHAT MESSAGES:\n${older.slice(-20).map(formatMemoryMessage).join('\n')}`);
  if (recent.length) {
    const balancedRecent = [...humans.map(m => ({ message: m, order: conversational.indexOf(m) })), ...assistants.map(m => ({ message: m, order: conversational.indexOf(m) }))].sort((a, b) => a.order - b.order).map(x => x.message);
    parts.push(`RECENT CONTEXT (last 5 human + last 5 AI messages, when available):\n${balancedRecent.map(formatMemoryMessage).join('\n')}`);
  }
  const previous = state.chats.filter(c => c.id !== chat.id && (c.summary || c.messages.length)).slice(0, 20);
  if (previous.length) parts.push(`PREVIOUS CHAT SUMMARIES:\n${previous.map(c => `- ${c.title}: ${c.summary || '(No summary yet; use remember to search this chat.)'}`).join('\n')}`);
  return parts.join('\n\n');
}

// ---------- Semantic memory ----------
function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

function tokenize(text) { return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(word => word.length > 2); }
function lexicalScore(text, query) {
  const words = tokenize(query), haystack = text.toLowerCase(), tokens = new Set(tokenize(text)); if (!words.length) return 0;
  let hits = 0; for (const word of words) if (tokens.has(word)) hits++;
  return hits / words.length + (haystack.includes(query.toLowerCase()) ? 0.45 : 0);
}

async function getEmbedding(text, model) {
  if (!text?.trim()) return null;
  const response = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: text }) });
  if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`);
  const data = await response.json(); return data.embeddings?.[0] || null;
}

async function indexMessage(chat, message) {
  if (!message.id || !message.content || !modelSelect.value || (message.role !== 'user' && message.role !== 'assistant')) return;
  const existing = memoryIndex.items.find(item => item.id === message.id && item.model === modelSelect.value); if (existing) return;
  try {
    const embedding = await getEmbedding(message.content, modelSelect.value); if (!embedding) return;
    memoryIndex.items = memoryIndex.items.filter(item => item.id !== message.id);
    memoryIndex.items.push({ id: message.id, chatId: chat.id, role: message.role, text: message.content, embedding, model: modelSelect.value, updatedAt: Date.now() });
    saveMemoryIndex(); updateMemoryStatus();
  } catch (error) { console.warn('Semantic indexing unavailable; lexical memory remains available.', error); }
}

async function remember(query, chatId = '', model = modelSelect.value) {
  query = String(query || '').trim();
  if (!query) return { found: false, skipped: true, message: 'No memory search was performed because the query was empty. Answer the user normally.' };
  const chats = chatId ? state.chats.filter(c => c.id === chatId) : state.chats;
  if (!chats.length) return { found: false, message: 'There are no saved chats to search.' };
  let queryEmbedding = null; try { queryEmbedding = await getEmbedding(query, model); } catch (_) {}
  const candidates = [];
  for (const chat of chats) {
    const msgs = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    for (let index = 0; index < msgs.length; index++) {
      const message = msgs[index], indexed = memoryIndex.items.find(item => item.id === message.id && item.model === model);
      const semantic = queryEmbedding && indexed?.embedding ? cosineSimilarity(queryEmbedding, indexed.embedding) : 0;
      const lexical = lexicalScore(message.content || '', query);
      const score = semantic ? semantic * 0.82 + lexical * 0.18 : lexical;
      if (score > 0.12) candidates.push({ chat, msgs, index, score });
    }
    if (chat.summary) { const score = lexicalScore(chat.summary, query) * 0.7; if (score > 0.12) candidates.push({ chat, summary: true, score }); }
  }
  candidates.sort((a, b) => b.score - a.score); const top = candidates.slice(0, 5);
  if (!top.length) return { found: false, message: `I searched ${chats.length} saved chat${chats.length === 1 ? '' : 's'}, but couldn't find a relevant memory for “${query}”.` };
  const results = top.map(hit => {
    if (hit.summary) return `CHAT: ${hit.chat.title}\nSUMMARY: ${hit.chat.summary}`;
    const start = Math.max(0, hit.index - 2), end = Math.min(hit.msgs.length, hit.index + 3);
    return `CHAT: ${hit.chat.title}\nRELEVANCE: ${(hit.score * 100).toFixed(0)}%\n${hit.msgs.slice(start, end).map(formatMemoryMessage).join('\n')}`;
  });
  return { found: true, query, results, instruction: 'Use these retrieved messages as factual remembered context. Do not invent details that are not present in the results.' };
}

async function ollamaChat(messages, model, stream = true, includeTools = true, think = true) {
  const body = { model, messages, stream, think };
  if (includeTools) body.tools = [REMEMBER_TOOL];
  const response = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`); return response;
}

async function summarizeChat(chat, model) {
  const conversational = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant'); if (conversational.length <= 10) return;
  const older = conversational.slice(0, -10);
  const prompt = `Create a compact factual memory summary of these older conversation messages. Preserve important facts, decisions, project details, preferences, names, and unresolved tasks. Do not invent anything.\n\n${older.map(formatMemoryMessage).join('\n')}`;
  try {
    const response = await ollamaChat([{ role: 'system', content: 'You write compact conversation memory summaries. Return only the summary.' }, { role: 'user', content: prompt }], model, false, false, false);
    const data = await response.json(); if (data.message?.content) chat.summary = data.message.content.trim();
  } catch (error) { console.warn('Memory summary update failed:', error); }
}

async function sendMessage(text) {
  if (isGenerating || !modelSelect.value) return;
  const chat = ensureActiveChat(), model = modelSelect.value; chat.model = model;
  if (!chat.messages.length) chat.title = titleFromFirstMessage(text);
  const userMessage = { id: uid(), role: 'user', content: text };
  chat.messages.push(userMessage); chat.updatedAt = Date.now(); saveState(); renderChatList();
  if (!chatEl.querySelector('.message')) renderActiveChat(); else addMessageElement('user', text);
  const assistantUI = addMessageElement('assistant', '');
  const bubble = assistantUI.bubble;
  const messageContent = assistantUI.content;
  isGenerating = true; sendButton.disabled = true; input.disabled = true; statusEl.textContent = 'Thinking…';

  try {
    await indexMessage(chat, userMessage);
    const system = `You are a helpful local AI inside Ollama Chat. Respond naturally and conversationally.\n\nTHINKING: You have thinking support. When useful, think through difficult questions before answering. Your thinking is shown in a collapsible Thinking block when the model provides it. For simple greetings and casual conversation, answer directly without unnecessary reasoning.\n\nMEMORY TOOL: You have a tool named remember for persistent conversation memory. Use it ONLY when the user's request genuinely requires information from older messages or another chat that is not confidently present in the current context. Do NOT call it for greetings, simple questions, casual conversation, or information already visible in the current context. NEVER call it with an empty query. If no older information is needed, just answer normally.\n\nMEMORY CONTEXT:\n${getMemoryContext(chat) || '(No saved memory yet.)'}`;
    const workingMessages = [{ role: 'system', content: system }, ...chat.messages];
    let answer = '', thinking = '', rounds = 0;

    while (rounds++ < 4) {
      const response = await ollamaChat(workingMessages, model, true, true, true), reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', roundText = '', roundThinking = ''; const toolCalls = [];
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue; const chunk = JSON.parse(line), message = chunk.message || {};
          roundText += message.content || '';
          roundThinking += message.thinking || '';
          if (Array.isArray(message.tool_calls)) toolCalls.push(...message.tool_calls);
          bubble.textContent = answer + roundText;
          if (roundThinking) setThinkingElement(messageContent, thinking + roundThinking);
          scrollToBottom();
        }
      }
      thinking += roundThinking;
      if (!toolCalls.length) { answer += roundText; break; }
      workingMessages.push({ role: 'assistant', content: roundText, thinking: roundThinking || undefined, tool_calls: toolCalls });
      for (const call of toolCalls) {
        if (call.function?.name !== 'remember') continue;
        let args = {}; try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function.arguments || {}); } catch (_) {}
        const query = String(args.query || '').trim();
        const result = query ? await remember(query, args.chat_id || '', model) : { found: false, skipped: true, message: 'Empty memory query ignored. Continue answering the user normally without memory.' };
        workingMessages.push({ role: 'tool', tool_name: 'remember', content: JSON.stringify(result) });
      }
      answer += roundText;
    }

    const assistantMessage = { id: uid(), role: 'assistant', content: answer || '(No response)' };
    if (thinking) assistantMessage.thinking = thinking;
    chat.messages.push(assistantMessage); chat.updatedAt = Date.now(); saveState(); renderChatList(); bubble.textContent = assistantMessage.content;
    await summarizeChat(chat, model); saveState();
    for (const message of chat.messages.slice(-12)) await indexMessage(chat, message);
    statusEl.textContent = model;
  } catch (error) {
    bubble.textContent = `Error: ${error.message}`; bubble.classList.add('error'); chat.messages.pop(); saveState(); statusEl.textContent = 'Request failed'; console.error(error);
  } finally { isGenerating = false; sendButton.disabled = false; input.disabled = false; input.focus(); }
}

function autoResize() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }

$('#newChat')?.addEventListener('click', createChat);
$('#refreshModels')?.addEventListener('click', loadModels);
$('#clearMemory')?.addEventListener('click', () => {
  if (!confirm('Delete all saved chats and memory?')) return;
  state = { version: MEMORY_VERSION, activeChatId: null, chats: [] }; memoryIndex = { version: 1, items: [] };
  saveState(); saveMemoryIndex(); renderChatList(); renderActiveChat();
});
$('#mobileMenu')?.addEventListener('click', () => { sidebar.classList.add('open'); mobileOverlay.classList.add('open'); });
mobileOverlay?.addEventListener('click', closeMobileSidebar);
searchEl?.addEventListener('input', renderChatList);
modelSelect?.addEventListener('change', () => { const chat = getActiveChat(); if (chat) { chat.model = modelSelect.value; saveState(); } });
form.addEventListener('submit', event => { event.preventDefault(); const text = input.value.trim(); if (!text || sendButton.disabled) return; input.value = ''; autoResize(); sendMessage(text); });
input.addEventListener('input', autoResize);
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });

renderChatList(); renderActiveChat(); updateMemoryStatus(); loadModels();
