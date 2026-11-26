(() => {
  'use strict';

  const STORAGE_KEY = 'messenger_current_userid';
  const MESSAGE_FETCH_LIMIT = 50;
  const GROUP_GAP_MS = 5 * 60 * 1000;
  const DIVIDER_GAP_MS = 15 * 60 * 1000;

  const AVATAR_COLORS = [
    '#0084FF',
    '#7B61FF',
    '#E85D75',
    '#00A400',
    '#F59E0B',
    '#0EA5E9',
    '#EC4899',
    '#14B8A6',
  ];

  // Application state
  const state = {
    users: [],
    onlineUsers: new Map(), // fld_userid -> user object
    messages: [],
    messageIds: new Set(),
    latestMessageByUser: new Map(), // fld_userid -> message object
    currentUser: null,
    selectedTargetId: 'GROUP_ALL', // 'GROUP_ALL' or a specific fld_userid
    searchQuery: '',
    typingUsers: new Map(), // fld_userid -> full_name
    isSending: false,
  };

  // DOM references
  const dom = {
    loginOverlay: document.getElementById('login-overlay'),
    userPickerList: document.getElementById('user-picker-list'),
    loginForm: document.getElementById('login-form'),
    userIdInput: document.getElementById('userid-input'),
    loginSubmitBtn: document.getElementById('login-submit-btn'),
    loginError: document.getElementById('login-error'),

    appShell: document.getElementById('app-shell'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    sidebarOnlinePill: document.getElementById('sidebar-online-pill'),
    currentUserChip: document.getElementById('current-user-chip'),
    switchUserBtn: document.getElementById('switch-user-btn'),
    sidebarSearchInput: document.getElementById('sidebar-search-input'),
    conversationList: document.getElementById('conversation-list'),

    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    chatHeaderAvatar: document.getElementById('chat-header-avatar'),
    chatHeaderName: document.getElementById('chat-header-name'),
    chatHeaderStatus: document.getElementById('chat-header-status'),
    onlineUsersIndicator: document.getElementById('online-users-indicator'),
    connectionBanner: document.getElementById('connection-banner'),

    messagesContainer: document.getElementById('messages-container'),
    messagesEmpty: document.getElementById('messages-empty'),
    messagesList: document.getElementById('messages-list'),

    typingIndicator: document.getElementById('typing-indicator'),
    typingText: document.getElementById('typing-text'),

    messageForm: document.getElementById('message-form'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
  };

  const socket = io();
  let typingTimeoutId = null;
  let isCurrentlyTyping = false;

  // ==================== Helpers ====================

  function getAvatarColor(seed) {
    const str = String(seed || 'user');
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function getInitials(userOrName) {
    if (!userOrName) return '?';
    if (typeof userOrName === 'object') {
      const first = (userOrName.fld_fname || '').trim();
      const last = (userOrName.fld_lname || '').trim();
      if (first && last) {
        return `${first[0]}${last[0]}`.toUpperCase();
      }
      const fallback = first || last || userOrName.fld_userid || '?';
      return fallback.slice(0, 2).toUpperCase();
    }
    const parts = String(userOrName).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return (parts[0] || '?').slice(0, 2).toUpperCase();
  }

  function createAvatarElement(user, sizeClass = 'size-md', showOnlineDot = false) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-wrap';

    const circle = document.createElement('div');
    circle.className = `avatar-circle ${sizeClass}`;
    circle.style.backgroundColor = getAvatarColor(user.fld_userid || user.full_name);
    circle.textContent = getInitials(user);
    wrap.appendChild(circle);

    if (showOnlineDot) {
      const dot = document.createElement('span');
      dot.className = sizeClass === 'size-sm' ? 'online-dot size-sm' : 'online-dot';
      dot.title = 'Online';
      wrap.appendChild(dot);
    }

    return wrap;
  }

  function createGroupAvatarElement(sizeClass = 'size-md', isOnline = false) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-wrap';

    const circle = document.createElement('div');
    circle.className = `avatar-circle group-avatar ${sizeClass}`;
    circle.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>';
    wrap.appendChild(circle);

    if (isOnline) {
      const dot = document.createElement('span');
      dot.className = 'online-dot';
      wrap.appendChild(dot);
    }

    return wrap;
  }

  function parseTimestamp(ts) {
    if (!ts) return new Date();
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  function formatTimeShort(ts) {
    const d = parseTimestamp(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatDividerTime(ts) {
    const d = parseTimestamp(ts);
    const now = new Date();
    const isSameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isSameDay) {
      return `Today, ${timePart}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();

    if (isYesterday) {
      return `Yesterday, ${timePart}`;
    }

    return d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    }) + `, ${timePart}`;
  }

  function formatFullTooltipTime(ts) {
    const d = parseTimestamp(ts);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function scrollMessagesToBottom(smooth = false) {
    dom.messagesContainer.scrollTo({
      top: dom.messagesContainer.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  function setOnlineUsersMap(usersArray) {
    state.onlineUsers.clear();
    if (Array.isArray(usersArray)) {
      usersArray.forEach((user) => {
        if (user && user.fld_userid) {
          state.onlineUsers.set(user.fld_userid, user);
        }
      });
    }
  }

  function isUserOnline(userId) {
    return state.onlineUsers.has(userId);
  }

  function showLoginError(message) {
    dom.loginError.textContent = message;
    dom.loginError.hidden = false;
  }

  function clearLoginError() {
    dom.loginError.textContent = '';
    dom.loginError.hidden = true;
  }

  function showConnectionBanner(message) {
    if (!message) {
      dom.connectionBanner.hidden = true;
      dom.connectionBanner.textContent = '';
      return;
    }
    dom.connectionBanner.textContent = message;
    dom.connectionBanner.hidden = false;
  }

  function openMobileSidebar() {
    dom.sidebar.classList.add('open');
    dom.sidebarBackdrop.hidden = false;
  }

  function closeMobileSidebar() {
    dom.sidebar.classList.remove('open');
    dom.sidebarBackdrop.hidden = true;
  }

  // ==================== API Requests ====================

  async function apiJson(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_err) {
      payload = null;
    }
    if (!response.ok) {
      const errorMsg = (payload && payload.error) || `Request failed (${response.status})`;
      throw new Error(errorMsg);
    }
    return payload;
  }

  async function loadUsers() {
    try {
      const data = await apiJson('/api/users');
      state.users = Array.isArray(data.users) ? data.users : [];
      renderUserPicker();
      renderSidebar();
    } catch (err) {
      console.error('Failed to load users:', err);
      dom.userPickerList.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'picker-loading';
      errDiv.textContent = 'Could not load users from database. Check server connection.';
      dom.userPickerList.appendChild(errDiv);
    }
  }

  async function loadMessages() {
    try {
      const data = await apiJson(`/api/messages?limit=${MESSAGE_FETCH_LIMIT}`);
      const loaded = Array.isArray(data.messages) ? data.messages : [];
      state.messages = [];
      state.messageIds.clear();
      state.latestMessageByUser.clear();

      loaded.forEach((msg) => {
        if (!state.messageIds.has(msg.fld_recno)) {
          state.messageIds.add(msg.fld_recno);
          state.messages.push(msg);
          state.latestMessageByUser.set(msg.fld_userid, msg);
        }
      });

      renderMessages();
      renderSidebar();
      scrollMessagesToBottom(false);
    } catch (err) {
      console.error('Failed to load messages:', err);
      showConnectionBanner('Unable to load recent messages. Please check your database connection.');
    }
  }

  async function loginWithUserId(userId) {
    const trimmed = String(userId || '').trim();
    if (!trimmed) {
      showLoginError('Please select or enter a user ID.');
      return;
    }

    clearLoginError();
    dom.loginSubmitBtn.disabled = true;
    dom.loginSubmitBtn.textContent = 'Joining...';

    try {
      const data = await apiJson('/api/login', {
        method: 'POST',
        body: JSON.stringify({ fld_userid: trimmed }),
      });

      state.currentUser = data.user;
      sessionStorage.setItem(STORAGE_KEY, data.user.fld_userid);

      // Ensure user list includes this user even if added after page load
      if (!state.users.some((u) => u.fld_userid === data.user.fld_userid)) {
        state.users.push(data.user);
      }

      enterChatApp();
    } catch (err) {
      showLoginError(err.message);
    } finally {
      dom.loginSubmitBtn.disabled = false;
      dom.loginSubmitBtn.textContent = 'Continue';
    }
  }

  function joinSocketRoom() {
    if (!state.currentUser || !socket.connected) return;
    socket.emit('user_join', { fld_userid: state.currentUser.fld_userid }, (ack) => {
      if (ack && ack.ok && Array.isArray(ack.onlineUsers)) {
        setOnlineUsersMap(ack.onlineUsers);
        renderAllPresence();
      } else if (ack && !ack.ok) {
        console.error('Socket join rejected:', ack.error);
      }
    });
  }

  async function enterChatApp() {
    dom.loginOverlay.hidden = true;
    dom.appShell.hidden = false;

    renderCurrentUserChip();
    renderChatHeader();
    renderSidebar();
    joinSocketRoom();

    await loadMessages();
    dom.messageInput.focus();
  }

  function switchUser() {
    stopTypingIndicator();
    socket.emit('user_leave');
    sessionStorage.removeItem(STORAGE_KEY);
    state.currentUser = null;
    state.typingUsers.clear();
    renderTypingIndicator();

    dom.appShell.hidden = true;
    dom.loginOverlay.hidden = false;
    dom.userIdInput.value = '';
    clearLoginError();
    renderUserPicker();
    dom.userIdInput.focus();
  }

  // ==================== Rendering ====================

  function renderUserPicker() {
    dom.userPickerList.innerHTML = '';

    if (state.users.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'picker-loading';
      empty.textContent = 'No users found in tbl_users.';
      dom.userPickerList.appendChild(empty);
      return;
    }

    state.users.forEach((user) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-user-btn';
      btn.addEventListener('click', () => {
        dom.userIdInput.value = user.fld_userid;
        loginWithUserId(user.fld_userid);
      });

      const avatar = createAvatarElement(user, 'size-md', isUserOnline(user.fld_userid));

      const info = document.createElement('div');
      info.className = 'picker-user-info';

      const name = document.createElement('div');
      name.className = 'picker-user-name';
      name.textContent = user.full_name;

      const sub = document.createElement('div');
      sub.className = 'picker-user-id';
      sub.textContent = isUserOnline(user.fld_userid)
        ? `@${user.fld_userid} • Active now`
        : `@${user.fld_userid}`;

      info.appendChild(name);
      info.appendChild(sub);

      const action = document.createElement('span');
      action.className = 'picker-user-action';
      action.textContent = 'Join';

      btn.appendChild(avatar);
      btn.appendChild(info);
      btn.appendChild(action);
      dom.userPickerList.appendChild(btn);
    });
  }

  function renderCurrentUserChip() {
    dom.currentUserChip.innerHTML = '';
    if (!state.currentUser) return;

    const avatar = createAvatarElement(state.currentUser, 'size-sm', true);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chip-name';
    nameSpan.textContent = state.currentUser.fld_fname || state.currentUser.fld_userid;

    dom.currentUserChip.appendChild(avatar);
    dom.currentUserChip.appendChild(nameSpan);
    dom.currentUserChip.title = `Signed in as ${state.currentUser.full_name} (@${state.currentUser.fld_userid})`;
  }

  function renderOnlineSummary() {
    const onlineArray = Array.from(state.onlineUsers.values());
    const count = onlineArray.length;
    dom.sidebarOnlinePill.textContent = `${count} online`;

    dom.onlineUsersIndicator.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = 'online-indicator-dot';
    dom.onlineUsersIndicator.appendChild(dot);

    if (count > 0) {
      const avatarStack = document.createElement('span');
      avatarStack.className = 'online-indicator-avatars';
      onlineArray.slice(0, 4).forEach((u) => {
        const mini = document.createElement('span');
        mini.className = 'mini-avatar';
        mini.style.backgroundColor = getAvatarColor(u.fld_userid);
        mini.textContent = getInitials(u);
        mini.title = `${u.full_name} (@${u.fld_userid})`;
        avatarStack.appendChild(mini);
      });
      dom.onlineUsersIndicator.appendChild(avatarStack);
    }

    const label = document.createElement('span');
    label.className = 'online-indicator-text';
    if (count === 0) {
      label.textContent = '0 online';
    } else if (count <= 2) {
      label.textContent = onlineArray.map((u) => u.fld_fname || u.fld_userid).join(', ') + ' online';
    } else {
      label.textContent = `${count} active now`;
    }
    dom.onlineUsersIndicator.appendChild(label);
    dom.onlineUsersIndicator.title =
      count > 0
        ? `Online: ${onlineArray.map((u) => `${u.full_name} (@${u.fld_userid})`).join(', ')}`
        : 'No connected users';
  }

  function renderSidebar() {
    dom.conversationList.innerHTML = '';

    const query = state.searchQuery.trim().toLowerCase();
    const lastGlobalMsg = state.messages[state.messages.length - 1];
    const onlineCount = state.onlineUsers.size;

    // Group / All Users conversation row
    if (!query || 'group chat all users everyone'.includes(query)) {
      const groupRow = document.createElement('button');
      groupRow.type = 'button';
      groupRow.className = `conversation-row ${state.selectedTargetId === 'GROUP_ALL' ? 'active' : ''}`;
      groupRow.addEventListener('click', () => {
        state.selectedTargetId = 'GROUP_ALL';
        renderSidebar();
        renderChatHeader();
        closeMobileSidebar();
      });

      const avatar = createGroupAvatarElement('size-lg', onlineCount > 0);
      const meta = document.createElement('div');
      meta.className = 'conversation-meta';

      const top = document.createElement('div');
      top.className = 'conversation-top';

      const title = document.createElement('span');
      title.className = 'conversation-name';
      title.textContent = 'Group Chat';

      const time = document.createElement('span');
      time.className = 'conversation-time';
      time.textContent = lastGlobalMsg ? formatTimeShort(lastGlobalMsg.fld_timestamp) : '';

      top.appendChild(title);
      top.appendChild(time);

      const preview = document.createElement('div');
      preview.className = 'conversation-preview';
      if (lastGlobalMsg) {
        const prefix =
          state.currentUser && lastGlobalMsg.fld_userid === state.currentUser.fld_userid
            ? 'You: '
            : `${lastGlobalMsg.fld_fname || lastGlobalMsg.fld_userid}: `;
        preview.textContent = `${prefix}${lastGlobalMsg.fld_message}`;
      } else {
        preview.textContent = 'All connected users';
      }

      meta.appendChild(top);
      meta.appendChild(preview);
      groupRow.appendChild(avatar);
      groupRow.appendChild(meta);
      dom.conversationList.appendChild(groupRow);
    }

    const heading = document.createElement('div');
    heading.className = 'sidebar-section-heading';
    heading.textContent = 'People';
    dom.conversationList.appendChild(heading);

    // Sort online users first, keeping stable order otherwise
    const filteredUsers = state.users
      .filter((u) => {
        if (!query) return true;
        return (
          u.full_name.toLowerCase().includes(query) ||
          u.fld_userid.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const aOnline = isUserOnline(a.fld_userid) ? 1 : 0;
        const bOnline = isUserOnline(b.fld_userid) ? 1 : 0;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.fld_recno - b.fld_recno;
      });

    filteredUsers.forEach((user) => {
      const online = isUserOnline(user.fld_userid);
      const isMe = state.currentUser && state.currentUser.fld_userid === user.fld_userid;
      const latestUserMsg = state.latestMessageByUser.get(user.fld_userid);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `conversation-row ${state.selectedTargetId === user.fld_userid ? 'active' : ''}`;
      row.addEventListener('click', () => {
        state.selectedTargetId = user.fld_userid;
        renderSidebar();
        renderChatHeader();
        closeMobileSidebar();
      });

      const avatar = createAvatarElement(user, 'size-lg', online);
      const meta = document.createElement('div');
      meta.className = 'conversation-meta';

      const top = document.createElement('div');
      top.className = 'conversation-top';

      const nameWrap = document.createElement('span');
      nameWrap.className = 'conversation-name';
      nameWrap.textContent = user.full_name;
      if (isMe) {
        const youSpan = document.createElement('span');
        youSpan.className = 'you-badge';
        youSpan.textContent = ' (You)';
        nameWrap.appendChild(youSpan);
      }

      const time = document.createElement('span');
      time.className = 'conversation-time';
      time.textContent = latestUserMsg ? formatTimeShort(latestUserMsg.fld_timestamp) : '';

      top.appendChild(nameWrap);
      top.appendChild(time);

      const preview = document.createElement('div');
      preview.className = `conversation-preview ${online && !latestUserMsg ? 'online-text' : ''}`;
      if (online) {
        preview.textContent = latestUserMsg
          ? `Active now • ${latestUserMsg.fld_message}`
          : 'Active now';
      } else {
        preview.textContent = latestUserMsg ? latestUserMsg.fld_message : `@${user.fld_userid} • Offline`;
      }

      meta.appendChild(top);
      meta.appendChild(preview);
      row.appendChild(avatar);
      row.appendChild(meta);
      dom.conversationList.appendChild(row);
    });
  }

  function renderChatHeader() {
    dom.chatHeaderAvatar.innerHTML = '';

    const selectedUser =
      state.selectedTargetId !== 'GROUP_ALL'
        ? state.users.find((u) => u.fld_userid === state.selectedTargetId)
        : null;

    if (selectedUser) {
      const online = isUserOnline(selectedUser.fld_userid);
      const avatarEl = createAvatarElement(selectedUser, 'size-md', online);
      dom.chatHeaderAvatar.replaceChildren(...avatarEl.childNodes);

      dom.chatHeaderName.textContent = selectedUser.full_name;
      dom.chatHeaderStatus.textContent = online
        ? `Active now • Shared chat (@${selectedUser.fld_userid})`
        : `Offline • Shared chat (@${selectedUser.fld_userid})`;
      dom.chatHeaderStatus.classList.toggle('is-online', online);
    } else {
      const onlineCount = state.onlineUsers.size;
      const groupAvatar = createGroupAvatarElement('size-md', onlineCount > 0);
      dom.chatHeaderAvatar.replaceChildren(...groupAvatar.childNodes);

      dom.chatHeaderName.textContent = 'Group Chat';
      dom.chatHeaderStatus.textContent =
        onlineCount > 0
          ? `${onlineCount} ${onlineCount === 1 ? 'person' : 'people'} active now`
          : 'No one else is online';
      dom.chatHeaderStatus.classList.toggle('is-online', onlineCount > 0);
    }
  }

  function renderAllPresence() {
    renderOnlineSummary();
    renderSidebar();
    renderChatHeader();
    if (!dom.loginOverlay.hidden) {
      renderUserPicker();
    }
  }

  function renderMessages(newestRecno = null) {
    dom.messagesList.innerHTML = '';

    if (state.messages.length === 0) {
      dom.messagesEmpty.hidden = false;
      return;
    }
    dom.messagesEmpty.hidden = true;

    // Group consecutive messages by sender within GROUP_GAP_MS
    const groups = [];
    state.messages.forEach((msg) => {
      const msgTime = parseTimestamp(msg.fld_timestamp).getTime();
      const prevGroup = groups[groups.length - 1];

      if (prevGroup) {
        const lastMsg = prevGroup.items[prevGroup.items.length - 1];
        const lastTime = parseTimestamp(lastMsg.fld_timestamp).getTime();
        const sameSender = prevGroup.fld_userid === msg.fld_userid;
        const closeInTime = msgTime - lastTime <= GROUP_GAP_MS;

        if (sameSender && closeInTime) {
          prevGroup.items.push(msg);
          return;
        }
      }

      groups.push({
        fld_userid: msg.fld_userid,
        sender_name: msg.sender_name || msg.fld_userid,
        fld_fname: msg.fld_fname,
        fld_lname: msg.fld_lname,
        items: [msg],
      });
    });

    let lastDividerTime = null;

    groups.forEach((group) => {
      const firstMsgTime = parseTimestamp(group.items[0].fld_timestamp).getTime();
      if (lastDividerTime === null || firstMsgTime - lastDividerTime > DIVIDER_GAP_MS) {
        const divider = document.createElement('div');
        divider.className = 'time-divider';
        divider.textContent = formatDividerTime(group.items[0].fld_timestamp);
        dom.messagesList.appendChild(divider);
      }
      lastDividerTime = parseTimestamp(group.items[group.items.length - 1].fld_timestamp).getTime();

      const isSent = state.currentUser && group.fld_userid === state.currentUser.fld_userid;
      const groupEl = document.createElement('div');
      groupEl.className = `message-group ${isSent ? 'sent' : 'received'}`;

      if (!isSent) {
        const senderLabel = document.createElement('div');
        senderLabel.className = 'group-sender-name';
        senderLabel.textContent = group.sender_name;
        groupEl.appendChild(senderLabel);
      }

      group.items.forEach((msg, index) => {
        const count = group.items.length;
        let posClass = 'pos-single';
        if (count > 1) {
          if (index === 0) posClass = 'pos-first';
          else if (index === count - 1) posClass = 'pos-last';
          else posClass = 'pos-middle';
        }

        const row = document.createElement('div');
        row.className = `message-row ${posClass}`;
        if (newestRecno !== null && msg.fld_recno === newestRecno) {
          row.classList.add('is-new');
        }

        if (!isSent) {
          const avatarSlot = document.createElement('div');
          avatarSlot.className = 'message-avatar-slot';
          if (index === count - 1) {
            avatarSlot.appendChild(
              createAvatarElement(
                {
                  fld_userid: msg.fld_userid,
                  fld_fname: msg.fld_fname,
                  fld_lname: msg.fld_lname,
                  full_name: msg.sender_name,
                },
                'size-sm',
                false
              )
            );
          }
          row.appendChild(avatarSlot);
        }

        const bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'message-bubble-wrap';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = msg.fld_message;

        const hoverTime = document.createElement('span');
        hoverTime.className = 'bubble-hover-time';
        hoverTime.textContent = formatFullTooltipTime(msg.fld_timestamp);

        bubbleWrap.appendChild(bubble);
        bubbleWrap.appendChild(hoverTime);
        row.appendChild(bubbleWrap);
        groupEl.appendChild(row);
      });

      const lastItem = group.items[group.items.length - 1];
      const groupTime = document.createElement('div');
      groupTime.className = 'group-timestamp';
      groupTime.textContent = formatTimeShort(lastItem.fld_timestamp);
      groupEl.appendChild(groupTime);

      dom.messagesList.appendChild(groupEl);
    });
  }

  function renderTypingIndicator() {
    const names = Array.from(state.typingUsers.values());
    if (names.length === 0) {
      dom.typingIndicator.hidden = true;
      dom.typingText.textContent = '';
      return;
    }

    dom.typingText.textContent =
      names.length === 1
        ? `${names[0]} is typing...`
        : `${names.length} people are typing...`;
    dom.typingIndicator.hidden = false;
  }

  // ==================== Messaging & Input ====================

  function updateComposerState() {
    const hasText = dom.messageInput.value.trim().length > 0;
    dom.sendBtn.disabled = !hasText || state.isSending;
    dom.sendBtn.classList.toggle('is-ready', hasText && !state.isSending);
  }

  function autoResizeInput() {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = `${Math.min(dom.messageInput.scrollHeight, 110)}px`;
  }

  function emitTyping(isTyping) {
    if (!state.currentUser || !socket.connected) return;
    if (isCurrentlyTyping !== isTyping) {
      isCurrentlyTyping = isTyping;
      socket.emit('typing', isTyping);
    }
  }

  function stopTypingIndicator() {
    if (typingTimeoutId) {
      clearTimeout(typingTimeoutId);
      typingTimeoutId = null;
    }
    emitTyping(false);
  }

  function appendIncomingMessage(msg) {
    if (!msg || typeof msg.fld_recno === 'undefined') return;
    if (state.messageIds.has(msg.fld_recno)) return;

    state.messageIds.add(msg.fld_recno);
    state.messages.push(msg);
    state.latestMessageByUser.set(msg.fld_userid, msg);
    state.typingUsers.delete(msg.fld_userid);
    renderTypingIndicator();

    renderMessages(msg.fld_recno);
    renderSidebar();
    scrollMessagesToBottom(true);
  }

  async function handleSendMessage(event) {
    if (event) event.preventDefault();
    if (!state.currentUser || state.isSending) return;

    const text = dom.messageInput.value.trim();
    if (!text) return;

    state.isSending = true;
    updateComposerState();
    stopTypingIndicator();

    try {
      const data = await apiJson('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          fld_userid: state.currentUser.fld_userid,
          fld_message: text,
        }),
      });

      dom.messageInput.value = '';
      autoResizeInput();
      showConnectionBanner('');

      // Render immediately if socket broadcast hasn't arrived yet (deduped by fld_recno)
      if (data && data.message) {
        appendIncomingMessage(data.message);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      showConnectionBanner(`Message not sent: ${err.message}`);
    } finally {
      state.isSending = false;
      updateComposerState();
      dom.messageInput.focus();
    }
  }

  // ==================== Event Listeners ====================

  dom.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    loginWithUserId(dom.userIdInput.value);
  });

  dom.switchUserBtn.addEventListener('click', switchUser);

  dom.sidebarSearchInput.addEventListener('input', (event) => {
    state.searchQuery = event.target.value;
    renderSidebar();
  });

  dom.mobileMenuBtn.addEventListener('click', openMobileSidebar);
  dom.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  dom.messageForm.addEventListener('submit', handleSendMessage);

  dom.messageInput.addEventListener('input', () => {
    autoResizeInput();
    updateComposerState();

    if (dom.messageInput.value.trim().length > 0) {
      emitTyping(true);
      clearTimeout(typingTimeoutId);
      typingTimeoutId = setTimeout(() => {
        emitTyping(false);
      }, 1500);
    } else {
      stopTypingIndicator();
    }
  });

  dom.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  });

  // ==================== Socket.IO Listeners ====================

  socket.on('connect', () => {
    showConnectionBanner('');
    if (state.currentUser) {
      joinSocketRoom();
    }
  });

  socket.on('online_users', (payload) => {
    if (payload && Array.isArray(payload.onlineUsers)) {
      setOnlineUsersMap(payload.onlineUsers);
      renderAllPresence();
    }
  });

  socket.on('user_connected', (payload) => {
    if (payload && Array.isArray(payload.onlineUsers)) {
      setOnlineUsersMap(payload.onlineUsers);
      renderAllPresence();
    }
  });

  socket.on('user_disconnected', (payload) => {
    if (payload && Array.isArray(payload.onlineUsers)) {
      setOnlineUsersMap(payload.onlineUsers);
    }
    if (payload && payload.user) {
      state.typingUsers.delete(payload.user.fld_userid);
      renderTypingIndicator();
    }
    renderAllPresence();
  });

  socket.on('new_message', (message) => {
    if (!state.currentUser) return;
    appendIncomingMessage(message);
  });

  socket.on('user_typing', (payload) => {
    if (!state.currentUser || !payload || payload.fld_userid === state.currentUser.fld_userid) {
      return;
    }
    if (payload.isTyping) {
      state.typingUsers.set(payload.fld_userid, payload.full_name || payload.fld_userid);
    } else {
      state.typingUsers.delete(payload.fld_userid);
    }
    renderTypingIndicator();
  });

  socket.on('disconnect', () => {
    showConnectionBanner('Connection lost. Attempting to reconnect...');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
    showConnectionBanner('Unable to reach real-time server. Retrying...');
  });

  // ==================== Init ====================

  async function init() {
    await loadUsers();

    const savedUserId = sessionStorage.getItem(STORAGE_KEY);
    if (savedUserId) {
      const matched = state.users.find(
        (u) => u.fld_userid.toLowerCase() === savedUserId.toLowerCase()
      );
      if (matched) {
        await loginWithUserId(matched.fld_userid);
        return;
      }
      sessionStorage.removeItem(STORAGE_KEY);
    }

    dom.userIdInput.focus();
  }

  init();
})();
