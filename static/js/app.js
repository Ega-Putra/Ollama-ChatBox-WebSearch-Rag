class ChatApp {
    constructor() {
        this.chatMessages = document.getElementById('chat-messages');
        this.messageInput = document.getElementById('message-input');
        this.loadingIndicator = document.getElementById('loading');
        this.modelSelect = document.getElementById('model-select');
        this.showThinking = document.getElementById('show-thinking');
        this.enableSearch = document.getElementById('enable-search');
        this.proxyEnable = document.getElementById('enable-proxy');
        this.proxyIp = document.getElementById('proxy-ip');
        this.proxyPort = document.getElementById('proxy-port');
        this.proxyTestBtn = document.getElementById('proxy-test-btn');
        this.proxyTestResult = document.getElementById('proxy-test-result');
        this.sessionsList = document.getElementById('sessions-list');
        this.currentSessionSpan = document.getElementById('current-session');
        
        this.sessions = [];
        this.currentSessionId = null;

        this.initializeEventListeners();
        // Start UI with no active session. A session will be created when the user sends the first message.
        this.currentSessionSpan.textContent = 'No Session';
        this.loadModels();
    }

    initializeEventListeners() {
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.sidebar')) {
                this.messageInput.focus();
            }
        });

        this.modelSelect.addEventListener('change', () => this.handleModelChange());
        // RAG file input
        this.contextFilesInput = document.getElementById('context-files');
        this.contextListEl = document.getElementById('context-list');
        if (this.contextFilesInput) {
            this.contextFilesInput.addEventListener('change', (e) => this.handleContextFiles(e.target.files));
        }
        // proxy UI
        if (this.proxyEnable && this.proxyIp && this.proxyPort) {
            // initialize state
            const setDisabled = (disabled) => {
                this.proxyIp.disabled = disabled;
                this.proxyPort.disabled = disabled;
                if (this.proxyTestBtn) this.proxyTestBtn.disabled = disabled;
            };
            setDisabled(!this.proxyEnable.checked);
            this.proxyEnable.addEventListener('change', () => {
                setDisabled(!this.proxyEnable.checked);
                if (!this.proxyEnable.checked && this.proxyTestResult) this.proxyTestResult.textContent = '';
            });
            if (this.proxyTestBtn) {
                this.proxyTestBtn.addEventListener('click', () => this.testProxy());
            }
        }
        // load existing contexts
        this.refreshContexts();
    }

    async handleContextFiles(fileList) {
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            await this.uploadContextFile(file);
        }
        // refresh list after uploads
        await this.refreshContexts();
        // clear input
        this.contextFilesInput.value = null;
    }

    async uploadContextFile(file) {
        try {
            const form = new FormData();
            form.append('file', file);
            const resp = await fetch('/upload-context', { method: 'POST', body: form });
            const data = await resp.json();
            if (data.error) {
                this.addMessage('Error uploading ' + file.name + ': ' + data.error, false);
            } else {
                this.addMessage('Uploaded context: ' + data.filename, false, false);
            }
        } catch (e) {
            this.addMessage('Upload failed: ' + e.message, false);
        }
    }

    async refreshContexts() {
        try {
            const resp = await fetch('/contexts');
            const data = await resp.json();
            if (data.contexts) {
                this.renderContextList(data.contexts);
            }
        } catch (e) {
            console.error('Could not load contexts', e);
        }
    }

    renderContextList(contexts) {
        if (!this.contextListEl) return;
        this.contextListEl.innerHTML = '';
        if (contexts.length === 0) {
            this.contextListEl.textContent = 'No context files uploaded.';
            return;
        }
        contexts.forEach(ctx => {
            const row = document.createElement('div');
            row.className = 'context-row';
            const name = document.createElement('span');
            name.textContent = ctx.filename;
            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.className = 'delete-context-btn';
            del.onclick = async () => {
                await this.deleteContext(ctx.filename);
                await this.refreshContexts();
            };
            row.appendChild(name);
            row.appendChild(del);
            this.contextListEl.appendChild(row);
        });
    }

    async deleteContext(filename) {
        try {
            const resp = await fetch('/delete-context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            const data = await resp.json();
            if (!data.success) {
                this.addMessage('Failed to delete ' + filename, false);
            } else {
                this.addMessage('Deleted context: ' + filename, false, false);
            }
        } catch (e) {
            this.addMessage('Error deleting context: ' + e.message, false);
        }
    }

    async loadModels() {
        try {
            const response = await fetch('/models');
            const data = await response.json();
            
            if (data.error) {
                console.error('Server error:', data.error);
                this.addMessage('Error loading models: ' + data.error, false);
                return;
            }

            this.modelSelect.innerHTML = '';
            
            if (data.models && data.models.length > 0) {
                data.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = model.name;
                    if (model.name === data.current_model) {
                        option.selected = true;
                    }
                    this.modelSelect.appendChild(option);
                });
                
                this.addMessage(`System initialized with model: ${data.current_model}`, false);
            } else {
                this.addMessage('No models found. Please make sure Ollama is running and has models installed.', false);
            }
        } catch (error) {
            console.error('Error loading models:', error);
            this.addMessage('Error loading models. Please make sure Ollama is running.', false);
        }
    }

    async handleModelChange() {
        try {
            const response = await fetch('/set-model', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model: this.modelSelect.value })
            });
            const data = await response.json();
            if (data.error) {
                this.addMessage('Error changing model: ' + data.error, false);
            } else {
                this.addMessage(`Model changed to: ${this.modelSelect.value}`, false);
            }
        } catch (error) {
            this.addMessage('Error changing model', false);
        }
    }

    startNewChat() {
        // Start a new unsaved session: no session is created yet until the user sends the first message.
        // This puts the UI into a blank state with no title.
        this.currentSessionId = null;
        this.chatMessages.innerHTML = '';
        this.currentSessionSpan.textContent = 'No Session';
        // Optionally show a placeholder message prompting the user
        this.addMessage('New blank session. Type a message to create the session and set its title.', false, false);
    }

    // Create a session using the first user message as the session title
    createSessionFromFirstMessage(firstMessage) {
        const sessionId = Date.now();
        // Use a truncated version of the first message as the session title
        const maxLen = 40;
        let title = firstMessage.trim();
        if (!title) title = `Chat ${this.sessions.length + 1}`;
        if (title.length > maxLen) title = title.slice(0, maxLen) + '...';
        const session = { id: sessionId, name: title, messages: [] };
        this.sessions.push(session);
        this.currentSessionId = sessionId;
        this.updateSessionsList();
        // clear any UI messages that might have been present (we start fresh for the session)
        this.chatMessages.innerHTML = '';
        this.currentSessionSpan.textContent = title;
    }

    clearChat() {
        this.chatMessages.innerHTML = '';
        this.addMessage('New chat session started.', false);
    }

    updateSessionsList() {
        this.sessionsList.innerHTML = '';
        this.sessions.forEach(session => {
            const sessionElement = document.createElement('div');
            sessionElement.className = `session-item ${session.id === this.currentSessionId ? 'active' : ''}`;
            
            const sessionContent = document.createElement('div');
            sessionContent.className = 'session-content';
            sessionContent.textContent = session.name;
            sessionContent.onclick = () => this.switchSession(session.id);
            sessionElement.appendChild(sessionContent);
            
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-session-btn';
            deleteButton.innerHTML = '×';
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                this.deleteSession(session.id);
            };
            sessionElement.appendChild(deleteButton);
            
            this.sessionsList.appendChild(sessionElement);
        });
    }

    deleteSession(sessionId) {
        // Remove the session from the array
        this.sessions = this.sessions.filter(s => s.id !== sessionId);

        // If there are no sessions left, set UI to no active session
        if (this.sessions.length === 0) {
            this.currentSessionId = null;
            this.chatMessages.innerHTML = '';
            this.currentSessionSpan.textContent = 'No Session';
            this.updateSessionsList();
            return;
        }

        // If we deleted the current session, switch to the last one
        if (sessionId === this.currentSessionId) {
            const lastSession = this.sessions[this.sessions.length - 1];
            this.switchSession(lastSession.id);
        } else {
            this.updateSessionsList();
        }
    }

    switchSession(sessionId) {
        this.currentSessionId = sessionId;
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            this.currentSessionSpan.textContent = session.name;
            this.chatMessages.innerHTML = '';
            
            // Add all messages at once
            const fragment = document.createDocumentFragment();
            session.messages.forEach(msg => {
                const container = document.createElement('div');
                container.className = 'message-container';

                const messageInfo = document.createElement('div');
                messageInfo.className = `message-info ${msg.isUser ? 'user-message-info' : 'ai-message-info'}`;
                messageInfo.textContent = msg.isUser ? 'user' : 'ai';
                container.appendChild(messageInfo);

                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${msg.isUser ? 'user-message' : 'ai-message'}`;
                messageDiv.textContent = msg.content;
                container.appendChild(messageDiv);

                fragment.appendChild(container);
            });
            
            this.chatMessages.appendChild(fragment);
            this.updateSessionsList();
            
            // Scroll to bottom after loading messages
            requestAnimationFrame(() => {
                this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            });
        }
    }

    saveMessageToSession(message, isUser) {
        const session = this.sessions.find(s => s.id === this.currentSessionId);
        if (session) {
            session.messages.push({ content: message, isUser });
        }
    }

    addMessage(message, isUser, save = true) {
        // Create container for the message group
        const container = document.createElement('div');
        container.className = 'message-container';

        // Create the message info (user/ai indicator)
        const messageInfo = document.createElement('div');
        messageInfo.className = `message-info ${isUser ? 'user-message-info' : 'ai-message-info'}`;
        messageInfo.textContent = isUser ? 'user' : 'ai';
        container.appendChild(messageInfo);

        // Create the message bubble
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        messageDiv.textContent = message;
        container.appendChild(messageDiv);

        // Add the container to chat
        this.chatMessages.appendChild(container);
        
        // Smooth scroll to the new message
        const scrollOptions = {
            top: this.chatMessages.scrollHeight,
            behavior: 'smooth'
        };

        // Use both scrollTo and scrollIntoView for better compatibility
        this.chatMessages.scrollTo(scrollOptions);
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        
        if (save) {
            this.saveMessageToSession(message, isUser);
        }
    }

    // Add a collapsible message bubble (used for search results and thinking)
    addCollapsibleMessage(title, content, isUser = false, collapsedByDefault = true, save = true) {
        const container = document.createElement('div');
        container.className = 'message-container';

        const messageInfo = document.createElement('div');
        messageInfo.className = `message-info ${isUser ? 'user-message-info' : 'ai-message-info'}`;
        messageInfo.textContent = isUser ? 'user' : 'ai';
        container.appendChild(messageInfo);

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;

        const header = document.createElement('div');
        header.className = 'collapsible-header';

        const toggle = document.createElement('button');
        toggle.className = 'toggle-btn';
        toggle.type = 'button';
        toggle.textContent = collapsedByDefault ? '\u25B6' : '\u25BC'; // ▶ or ▼
        header.appendChild(toggle);

        const titleEl = document.createElement('span');
        titleEl.className = 'collapsible-title';
        titleEl.textContent = title;
        header.appendChild(titleEl);

        messageDiv.appendChild(header);

        const body = document.createElement('div');
        body.className = 'collapsible-body';
        if (collapsedByDefault) {
            body.style.display = 'none';
        }

        const pre = document.createElement('pre');
        pre.className = 'collapsible-content';
        pre.textContent = content;
        body.appendChild(pre);

        messageDiv.appendChild(body);
        container.appendChild(messageDiv);

        // Toggle behavior
        const toggleHandler = () => {
            const isCollapsed = body.style.display === 'none';
            if (isCollapsed) {
                body.style.display = '';
                toggle.textContent = '\u25BC';
            } else {
                body.style.display = 'none';
                toggle.textContent = '\u25B6';
            }
        };

        toggle.addEventListener('click', toggleHandler);
        header.addEventListener('click', (e) => {
            // allow clicking header to toggle as well, but avoid double-trigger when pressing button
            if (e.target === toggle) return;
            toggleHandler();
        });

        this.chatMessages.appendChild(container);

        // scroll into view
        this.chatMessages.scrollTo({ top: this.chatMessages.scrollHeight, behavior: 'smooth' });
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });

        if (save) {
            // Save a simple representation to session
            this.saveMessageToSession(`${title}\n${content}`, isUser);
        }

        return { container, header, body, toggle };
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        // If there is no active session yet, create one using the first message as the title
        if (!this.currentSessionId) {
            this.createSessionFromFirstMessage(message);
        }

        this.addMessage(message, true);
        this.messageInput.value = '';

        if (this.showThinking.checked) {
            if (this.enableSearch.checked) {
                // show a thinking bubble that can be collapsed by the user
                // collapsedByDefault = !showThinking (if showThinking is checked, show it expanded)
                this.thinkingBubble = this.addCollapsibleMessage('Thinking', 'Searching the web...', false, !this.showThinking.checked, false);
            }
            this.loadingIndicator.style.display = 'block';
        }

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    search: this.enableSearch.checked
                    ,
                    proxyEnabled: this.proxyEnable ? this.proxyEnable.checked : false,
                    proxyIp: this.proxyIp ? this.proxyIp.value : '',
                    proxyPort: this.proxyPort ? this.proxyPort.value : ''
                })
            });

            const data = await response.json();
            
            if (data.error) {
                this.addMessage('Error: ' + data.error, false);
            } else {
                // remove thinking bubble if present
                if (this.thinkingBubble && this.thinkingBubble.container) {
                    try { this.thinkingBubble.container.remove(); } catch (e) {}
                    this.thinkingBubble = null;
                }

                if (data.searchPerformed && data.searchContext) {
                    // add collapsible search results (collapsed by default)
                    this.addCollapsibleMessage('Web Search Results', data.searchContext, false, true, false);
                } else if (data.searchPerformed) {
                    this.addMessage('Search completed. Processing results...', false, false);
                }
                this.addMessage(data.response, false);
            }
        } catch (error) {
            this.addMessage('Error: Could not connect to the server', false);
        } finally {
            this.loadingIndicator.style.display = 'none';
        }
    }

    async testProxy() {
        if (!this.proxyEnable || !this.proxyIp || !this.proxyPort) return;
        const enabled = this.proxyEnable.checked;
        const ip = (this.proxyIp.value || '').trim();
        const port = (this.proxyPort.value || '').trim();
        if (!enabled) {
            this.addMessage('Proxy is not enabled.', false);
            return;
        }
        if (!ip || !port) {
            this.addMessage('Please provide proxy IP and port.', false);
            return;
        }
        if (this.proxyTestResult) this.proxyTestResult.textContent = 'Testing...';
        try {
            const resp = await fetch('/test-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxyEnabled: true, proxyIp: ip, proxyPort: port })
            });
            const data = await resp.json();
            if (data && data.success) {
                const details = data.details ? ` Status ${data.status_code}. ${data.details}` : ` Status ${data.status_code}`;
                this.addMessage('Proxy test succeeded.' + details, false);
                if (this.proxyTestResult) this.proxyTestResult.textContent = 'Proxy OK';
            } else {
                const err = (data && data.error) ? data.error : 'Unknown error';
                this.addMessage('Proxy test failed: ' + err, false);
                if (this.proxyTestResult) this.proxyTestResult.textContent = 'Proxy failed';
            }
        } catch (e) {
            this.addMessage('Proxy test error: ' + e.message, false);
            if (this.proxyTestResult) this.proxyTestResult.textContent = 'Error';
        }
    }
}

// Initialize the app when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});