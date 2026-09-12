const OLLAMA = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-chat-state-v2';
const MEMORY_VERSION = 1;

const $ = (selector) => document.querySelector(selector);
const modelSelect = $('#model');
const statusEl = $('#status');
const chatEl = $('#chat');
const welcomeEl = $('#welcome');
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
    description: 'Search the saved conversation memory. Use this when you need to recall something from older messages or previous chats. It returns the most relevant chat area around matching messages, plus summaries. This is a local memory search across chats saved in this browser.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to remember or search for.' },
        chat_id: { type: 'string', description: 'Optional chat ID to limit the search to one chat.' }
      },
      required: ['query']
    }
  }
};

let state = loadState();
let isGenerating = false;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.version === MEMORY_VERSION && Array.isArray(saved.chats)) return saved;
  } catch (error) { console.warn('Could not load saved memory:', error); }
  return { version: MEMORY_VERSION, activeChatId: null, chats: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateMemoryStatus();
}

function createChat() {
  const chat = { id: uid(), title: 'New chat', model: modelSelect.value || '', messages: [], summary: '', updatedAt: Date.now() };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  saveState();
  renderChatList();
  renderActiveChat();
  closeMobileSidebar();
  input.focus();
  return chat;
}

function getActiveChat() {
  return state.chats.find(chat => chat.id === state.activeChatId) || null;
}

function ensureActiveChat() {
  return getActiveChat() || createChat();
}

function deleteChat(id) {
  state.chats = state.chats.filter(chat => chat.id !== id);
  if (state.activeChatId === id) state.activeChatId = state.chats[0]?.id || null;
  saveState();
  renderChatList();
  renderActiveChat();
}

function selectChat(id) {
  if (isGenerating) return;
  state.activeChatId = id;
  saveState();
  renderChatList();
  renderActiveChat();
  closeMobileSidebar();
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderChatList() {
  const query = searchEl.value.trim().toLowerCase();
  chatListEl.innerHTML = '';
  const chats = state.chats.filter(chat => {
    if (!query) return true;
    return `${chat.title} ${chat.summary} ${chat.messages.map(m => m.content).join(' ')}`.toLowerCase().includes(query);
  });
  if (!chats.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-item-meta';
    empty.style.padding = '10px';
    empty.textContent = query ? 'No matching chats' : 'No chats yet';
    chatListEl.appendChild(empty);
    return;
  }
  for (const chat of chats) {
    const item = document.createElement('button');
    item.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`;
    item.type = 'button';
    item.innerHTML = `<div class="chat-item-title"></div><div class="chat-item-meta"></div><span class="delete-chat" title="Delete chat">×</span>`;
    item.querySelector('.chat-item-title').textContent = chat.title || 'New chat';
    item.querySelector('.chat-item-meta').textContent = chat.messages.length ? formatDate(chat.updatedAt) : 'Empty';
    item.addEventListener('click', (event) => {
      if (event.target.classList.contains('delete-chat')) {
        event.stopPropagation();
        deleteChat(chat.id);
        return;
      }
      selectChat(chat.id);
    });
    chatListEl.appendChild(item);
  }
}

function renderActiveChat() {
  const chat = getActiveChat();
  chatEl.innerHTML = '';
  if (!chat || !chat.messages.length) {
    const welcome = welcomeEl.cloneNode(true);
    welcome.style.display = '';
    chatEl.appendChild(welcome);
    chatTitleEl.textContent = chat?.title || 'New chat';
    return;
  }
  chatTitleEl.textContent = chat.title;
  for (const message of chat.messages) {
    if (message.role === 'system' || message.role === 'tool') continue;
    addMessageElement(message.role, message.content);
  }
  scrollToBottom();
}

function addMessageElement(role, text = '') {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;
  const row = document.createElement('div');
  row.className = 'message-row';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'Y' : '✦';
  const content = document.createElement('div');
  content.className = 'message-content';
  const roleLabel = document.createElement('div');
  roleLabel.className = 'role';
  roleLabel.textContent = role === 'user' ? 'You' : 'AI';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  content.append(roleLabel, bubble);
  row.append(avatar, content);
  wrapper.appendChild(row);
  chatEl.appendChild(wrapper);
  welcomeEl?.remove();
  return bubble;
}

function scrollToBottom() { chatEl.scrollTop = chatEl.scrollHeight; }
function closeMobileSidebar() { sidebar.classList.remove('open'); mobileOverlay.classList.remove('open'); }
function updateMemoryStatus() {
  const total = state.chats.reduce((sum, chat) => sum + chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').length, 0);
  memoryStatusEl.textContent = `${state.chats.length} chat${state.chats.length === 1 ? '' : 's'} · ${total} saved messages`;
}

async function loadModels() {
  statusEl.textContent = 'Connecting to Ollama…';
  statusEl.className = '';
  try {
    const response = await fetch(`${OLLAMA}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = data.models || [];
    modelSelect.innerHTML = '';
    if (!models.length) {
      modelSelect.innerHTML = '<option value="">No models installed</option>';
      modelSelect.disabled = true;
      statusEl.textContent = 'No models found';
      return;
    }
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.name;
      option.textContent = model.name;
      modelSelect.appendChild(option);
    }
    const active = getActiveChat();
    if (active?.model && models.some(m => m.name === active.model)) modelSelect.value = active.model;
    modelSelect.disabled = false;
    statusEl.textContent = `${models.length} model${models.length === 1 ? '' : 's'} ready`;
  } catch (error) {
    modelSelect.innerHTML = '<option value="">Ollama unavailable</option>';
    modelSelect.disabled = true;
    statusEl.textContent = 'Can’t connect to Ollama';
    statusEl.className = 'error';
    console.error(error);
  }
}

function titleFromFirstMessage(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || 'New chat';
}

function getMemoryContext(chat) {
  const conversational = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const recent = conversational.slice(-10);
  const older = conversational.slice(0, Math.max(0, conversational.length - 10));
  const parts = [];
  if (chat.summary) parts.push(`CURRENT CHAT SUMMARY:\n${chat.summary}`);
  if (older.length && !chat.summary) parts.push(`OLDER CURRENT-CHAT MESSAGES:\n${older.map(formatMemoryMessage).join('\n')}`);
  if (recent.length) parts.push(`LAST 10 MESSAGES (up to 5 user + 5 AI messages):\n${recent.map(formatMemoryMessage).join('\n')}`);

  const previous = state.chats.filter(c => c.id !== chat.id && (c.summary || c.messages.length)).slice(0, 12);
  if (previous.length) {
    parts.push(`PREVIOUS CHAT SUMMARIES:\n${previous.map(c => `- ${c.title}: ${c.summary || '(No summary yet; use remember to search this chat.)'}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

function formatMemoryMessage(message) {
  return `[${message.role === 'user' ? 'Human' : 'AI'}] ${message.content}`;
}

function remember(query, chatId = '') {
  const q = query.toLowerCase().trim();
  if (!q) return { found: false, message: 'No search query was provided.' };
  const candidates = [];
  const chats = chatId ? state.chats.filter(c => c.id === chatId) : state.chats;
  for (const chat of chats) {
    const searchableSummary = (chat.summary || '').toLowerCase();
    const summaryScore = scoreMatch(searchableSummary, q);
    if (summaryScore > 0) candidates.push({ chat, index: -1, score: summaryScore * 1.5, kind: 'summary' });
    const msgs = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    msgs.forEach((message, index) => {
      const score = scoreMatch((message.content || '').toLowerCase(), q);
      if (score > 0) candidates.push({ chat, index, score, kind: 'message' });
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 6);
  if (!top.length) return { found: false, message: `I searched ${chats.length} saved chat${chats.length === 1 ? '' : 's'}, but found nothing matching “${query}”.` };
  const results = top.map(hit => {
    if (hit.kind === 'summary') return `CHAT: ${hit.chat.title}\nSUMMARY: ${hit.chat.summary}`;
    const msgs = hit.chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const start = Math.max(0, hit.index - 2);
    const end = Math.min(msgs.length, hit.index + 3);
    return `CHAT: ${hit.chat.title}\n${msgs.slice(start, end).map(formatMemoryMessage).join('\n')}`;
  });
  return { found: true, query, results, instruction: 'Use these results as remembered context. Do not claim to remember something that is not present here.' };
}

function scoreMatch(text, query) {
  const words = query.split(/\s+/).filter(Boolean);
  let score = text.includes(query) ? 8 : 0;
  for (const word of words) if (word.length > 2 && text.includes(word)) score += 1;
  return score;
}

async function ollamaChat(messages, model, stream = true, includeTools = true) {
  const body = { model, messages, stream };
  if (includeTools) body.tools = [REMEMBER_TOOL];
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function summarizeChat(chat, model) {
  const conversational = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  if (conversational.length <= 10) return;
  const older = conversational.slice(0, -10);
  const prompt = `Create a compact factual memory summary of these older conversation messages. Preserve important facts, decisions, project details, preferences, names, and unresolved tasks. Do not invent anything. This summary will be used as context in future chats.\n\n${older.map(formatMemoryMessage).join('\n')}`;
  try {
    const response = await ollamaChat([
      { role: 'system', content: 'You write compact conversation memory summaries. Return only the summary.' },
      { role: 'user', content: prompt }
    ], model, false, false);
    const data = await response.json();
    if (data.message?.content) chat.summary = data.message.content.trim();
  } catch (error) {
    console.warn('Memory summary update failed:', error);
  }
}

async function sendMessage(text) {
  if (isGenerating || !modelSelect.value) return;
  const chat = ensureActiveChat();
  const model = modelSelect.value;
  chat.model = model;
  if (!chat.messages.length) chat.title = titleFromFirstMessage(text);
  chat.messages.push({ role: 'user', content: text });
  chat.updatedAt = Date.now();
  saveState();
  renderChatList();
  if (!chatEl.querySelector('.message')) renderActiveChat();
  else addMessageElement('user', text);
  const bubble = addMessageElement('assistant', '');
  isGenerating = true;
  sendButton.disabled = true;
  input.disabled = true;
  statusEl.textContent = 'Thinking…';

  try {
    const system = `You are a helpful local AI inside Ollama Chat. You have persistent local conversation memory.

IMPORTANT: You have a tool named remember. CALL remember whenever the user asks about something from an older message, another chat, a prior decision, a forgotten detail, or anything you cannot confidently answer from the context supplied. It searches the user's saved chats and returns the nearby conversation around matches. You are allowed and encouraged to use it. Never pretend you remember something that you have not been given or retrieved.

MEMORY CONTEXT:
${getMemoryContext(chat) || '(No saved memory yet.)'}`;

    const workingMessages = [
      { role: 'system', content: system },
      ...chat.messages
    ];
    let answer = '';
    let toolRounds = 0;

    while (toolRounds < 4) {
      const response = await ollamaChat(workingMessages, model, true, true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let roundAnswer = '';
      const toolCalls = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line);
          const message = chunk.message || {};
          roundAnswer += message.content || '';
          if (Array.isArray(message.tool_calls)) toolCalls.push(...message.tool_calls);
          bubble.textContent = answer + roundAnswer;
          scrollToBottom();
        }
      }

      if (!toolCalls.length) {
        answer += roundAnswer;
        break;
      }

      // The model asked to use remember. Preserve its assistant tool-call message,
      // execute locally, then send the result back to Ollama for the final answer.
      const assistantToolMessage = { role: 'assistant', content: roundAnswer || '' , tool_calls: toolCalls };
      workingMessages.push(assistantToolMessage);
      for (const call of toolCalls) {
        if (call.function?.name !== 'remember') continue;
        let args = {};
        try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function.arguments || {}); } catch {}
        const result = remember(args.query || '', args.chat_id || '');
        workingMessages.push({ role: 'tool', content: JSON.stringify(result) });
        const note = document.createElement('div');
        note.className = 'tool-note';
        note.textContent = `◈ Remember searched: ${args.query || 'memory'}`;
        bubble.parentElement.appendChild(note);
      }
      toolRounds++;
      answer += roundAnswer;
    }

    chat.messages.push({ role: 'assistant', content: answer });
    chat.updatedAt = Date.now();
    await summarizeChat(chat, model);
    saveState();
    renderChatList();
    statusEl.textContent = model;
  } catch (error) {
    bubble.textContent = `Error: ${error.message}`;
    bubble.classList.add('error');
    const last = chat.messages[chat.messages.length - 1];
    if (last?.role === 'user' && !chat.messages.some(m => m.role === 'assistant' && m.content)) chat.messages.pop();
    statusEl.textContent = 'Request failed';
    statusEl.className = 'error';
    console.error(error);
  } finally {
    isGenerating = false;
    sendButton.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || isGenerating) return;
  input.value = '';
  input.style.height = 'auto';
  sendMessage(text);
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
});
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
$('#newChat').addEventListener('click', createChat);
$('#refreshModels').addEventListener('click', loadModels);
searchEl.addEventListener('input', renderChatList);
modelSelect.addEventListener('change', () => { const chat = getActiveChat(); if (chat) { chat.model = modelSelect.value; saveState(); } });
$('#clearMemory').addEventListener('click', () => {
  if (!confirm('Delete all saved chats and memory from this browser?')) return;
  state = { version: MEMORY_VERSION, activeChatId: null, chats: [] };
  saveState(); renderChatList(); renderActiveChat();
});
$('#mobileMenu').addEventListener('click', () => { sidebar.classList.add('open'); mobileOverlay.classList.add('open'); });
mobileOverlay.addEventListener('click', closeMobileSidebar);

if (state.activeChatId && !getActiveChat()) state.activeChatId = null;
renderChatList();
renderActiveChat();
updateMemoryStatus();
loadModels();
