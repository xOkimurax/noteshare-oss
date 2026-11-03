#!/usr/bin/env node
/**
 * Noteshare MCP server.
 *
 * Talks to the Noteshare REST API with a personal access token. Generate a
 * token in Settings -> Integración MCP, then configure Claude Desktop:
 *
 *   "mcpServers": {
 *     "noteshare": {
 *       "command": "node",
 *       "args": ["/absolute/path/to/noteshare-mcp.js"],
 *       "env": {
 *         "NOTESHARE_API_URL": "https://api.your-domain.com",
 *         "NOTESHARE_TOKEN": "ns_pat_xxx"
 *       }
 *     }
 *   }
 */
import readline from 'node:readline';

const API_URL = (process.env.NOTESHARE_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.NOTESHARE_TOKEN;

if (!API_URL || !TOKEN) {
  console.error('Error: NOTESHARE_API_URL and NOTESHARE_TOKEN must be set.');
  process.exit(1);
}

async function apiFetch(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      `API ${method} ${path} -> ${res.status}: ${data?.error || text}`,
    );
  }
  return data;
}

function ok(text) {
  return { content: [{ type: 'text', text }] };
}

const SHARE_FIELDS = ['shareCode', 'allowAnyone', 'allowedEmails'];

// --- readable summaries for the list_* tools ---------------------------------

function fmtContact(c) {
  const star = c.favorite ? '★ ' : '';
  const who = c.alias ? `${c.alias} (${c.name})` : c.name;
  const status = c.hasAccount ? 'has account' : 'invited, no account';
  return `${star}${who} <${c.email}> — ${status} [${c.source}] · id ${c.id}`;
}

function fmtConversation(c) {
  const last = c.lastMessage
    ? `${c.lastMessage.mine ? 'you: ' : ''}${c.lastMessage.body}`
    : '(no messages yet)';
  const unread = c.unread ? ` · ${c.unread} unread` : '';
  return `${c.other.name} <${c.other.email}> — "${last}"${unread} · id ${c.id}`;
}

function fmtMessage(m) {
  const when = new Date(m.createdAt).toLocaleString();
  const prefix = `${when} — ${m.mine ? 'you' : 'them'}: `;
  if (m.sharedNote) {
    const acc = m.sharedNote.accessible ? '' : ' (no access)';
    const note = `📎 ${m.sharedNote.title} [${m.sharedNote.type}]${acc} · note id ${m.sharedNote.id}`;
    return prefix + (m.body ? `${m.body}\n    ${note}` : note);
  }
  return prefix + m.body;
}

function fmtComment(c) {
  const when = new Date(c.createdAt).toLocaleString();
  const edited = c.editedAt ? ' (edited)' : '';
  return `${c.authorName} · ${when}${edited} · id ${c.id}\n  ${c.body}`;
}

function fmtSharedNote(m) {
  const role = m.role ? ` [${m.role}]` : '';
  const people = m.allowedEmails?.length
    ? ` · shared with ${m.allowedEmails.length}`
    : '';
  const pub = m.isPublic ? ' · public' : '';
  return `${m.title || '(untitled)'}${role}${people}${pub} · id ${m.id}`;
}

const TOOLS = [
  {
    name: 'list_notes',
    description:
      'List all notes (memos) belonging to the user. Optionally filter by type or folder.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['note', 'list'],
          description:
            "Filter by note type. 'list' notes are the ones shown on the Kanban board.",
        },
        folderId: { type: 'string', description: 'Filter by folder ID.' },
      },
    },
  },
  {
    name: 'create_note',
    description:
      "Create a new note. Notes with type='list' appear on the Kanban board and support kanbanStatus; type='note' are regular notes.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        type: { type: 'string', enum: ['note', 'list'] },
        color: { type: 'string', description: 'Hex color, e.g. #ffffff' },
        tags: { type: 'array', items: { type: 'string' } },
        folderId: { type: 'string' },
        dueDate: { type: 'string', description: 'ISO datetime.' },
        location: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            name: { type: 'string' },
          },
        },
        kanbanStatus: {
          type: 'string',
          enum: ['pending', 'in-progress', 'completed'],
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'update_note',
    description:
      'Update an existing note: text, type, color, tags, due date, location, folder, kanban status (also logs the time), or sharing settings.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        type: { type: 'string', enum: ['note', 'list'] },
        color: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        dueDate: { type: 'string' },
        location: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            name: { type: 'string' },
          },
        },
        kanbanStatus: {
          type: 'string',
          enum: ['pending', 'in-progress', 'completed'],
        },
        folderId: {
          type: 'string',
          description: 'Move into a folder, or empty string / null to remove.',
        },
        shareCode: { type: 'string' },
        allowAnyone: { type: 'boolean' },
        allowedEmails: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_note',
    description: 'Delete a note by ID. Only the owner can delete.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_folders',
    description: 'List all folders belonging to the user.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder to organize notes.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'rename_folder',
    description: 'Rename an existing folder.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
    },
  },
  {
    name: 'delete_folder',
    description:
      'Delete a folder by ID. Notes inside are kept and move back to the root.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // --- contacts (personal address book) ---
  {
    name: 'list_contacts',
    description:
      "List the user's contacts (personal address book). Favourites first, then by name.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_contact',
    description:
      'Add a contact by email address. If the email has no Noteshare account yet, it is still saved and marked as invited.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        alias: { type: 'string', description: 'Optional nickname for this contact.' },
      },
      required: ['email'],
    },
  },
  {
    name: 'update_contact',
    description: "Update a contact's alias and/or favourite flag.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Contact ID (from list_contacts).' },
        alias: { type: 'string', description: 'New nickname; empty string clears it.' },
        favorite: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'remove_contact',
    description: 'Remove a contact from the address book by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // --- chat (1:1 direct messages) ---
  {
    name: 'list_conversations',
    description:
      'List the 1:1 chat conversations, most recently active first, with the last message and unread count.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'open_conversation',
    description:
      'Find or create the 1:1 conversation with another person, identified by email or userId. Returns the conversation (use its id for list_messages / send_message).',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        userId: { type: 'string' },
      },
    },
  },
  {
    name: 'list_messages',
    description:
      'List messages in a conversation, oldest-first within the page. Page backwards with "before" (an ISO timestamp from the earliest message you have).',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string' },
        before: { type: 'string', description: 'ISO datetime; return messages older than this.' },
        limit: { type: 'number', description: 'Page size, 1-100 (default 30).' },
      },
      required: ['conversationId'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a text message in a conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['conversationId', 'body'],
    },
  },
  {
    name: 'send_note',
    description:
      'Send one of your own notes into a conversation. The note is shared with the recipient (added to its allowed emails) as it is sent. Optionally include a text caption.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string' },
        memoId: { type: 'string', description: 'ID of a note you own.' },
        body: { type: 'string', description: 'Optional caption.' },
      },
      required: ['conversationId', 'memoId'],
    },
  },

  // --- comments (threads on a note) ---
  {
    name: 'list_comments',
    description: 'List the comment thread on a note.',
    inputSchema: {
      type: 'object',
      properties: { memoId: { type: 'string' } },
      required: ['memoId'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a note (requires write access to it).',
    inputSchema: {
      type: 'object',
      properties: {
        memoId: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['memoId', 'body'],
    },
  },
  {
    name: 'delete_comment',
    description:
      'Delete a comment. Allowed for the comment author or the note owner.',
    inputSchema: {
      type: 'object',
      properties: {
        memoId: { type: 'string' },
        commentId: { type: 'string' },
      },
      required: ['memoId', 'commentId'],
    },
  },

  // --- shared notes ---
  {
    name: 'list_shared_notes',
    description:
      'List notes shared with the user plus notes the user shares with others.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'list_notes': {
      let notes = await apiFetch('GET', '/api/memos');
      if (args.type) notes = notes.filter((n) => n.type === args.type);
      if (args.folderId)
        notes = notes.filter((n) => n.folderId === args.folderId);
      return ok(JSON.stringify(notes, null, 2));
    }
    case 'create_note': {
      const body = {
        title: args.title,
        content: args.content || '',
        type: args.type === 'list' ? 'list' : 'note',
        color: args.color || '#ffffff',
        tags: args.tags || [],
      };
      if (args.folderId !== undefined) body.folderId = args.folderId || null;
      if (args.dueDate !== undefined) body.dueDate = args.dueDate || null;
      if (args.location !== undefined) body.location = args.location || null;
      if (args.kanbanStatus) body.kanbanStatus = args.kanbanStatus;
      const memo = await apiFetch('POST', '/api/memos', body);
      return ok(`Note created: ${memo.id} (type: ${memo.type})`);
    }
    case 'update_note': {
      const { id } = args;
      const patch = {};
      for (const f of [
        'title',
        'content',
        'type',
        'color',
        'tags',
        'dueDate',
        'location',
        'kanbanStatus',
      ]) {
        if (args[f] !== undefined) patch[f] = args[f];
      }
      if (args.folderId !== undefined) patch.folderId = args.folderId || null;
      if (Object.keys(patch).length) {
        await apiFetch('PATCH', `/api/memos/${id}`, patch);
      }
      const share = {};
      for (const f of SHARE_FIELDS) if (args[f] !== undefined) share[f] = args[f];
      if (Object.keys(share).length) {
        await apiFetch('PATCH', `/api/memos/${id}/share`, share);
      }
      return ok(`Note ${id} updated.`);
    }
    case 'delete_note':
      await apiFetch('DELETE', `/api/memos/${args.id}`);
      return ok(`Note ${args.id} deleted.`);
    case 'list_folders':
      return ok(JSON.stringify(await apiFetch('GET', '/api/folders'), null, 2));
    case 'create_folder': {
      const folder = await apiFetch('POST', '/api/folders', { name: args.name });
      return ok(`Folder created: ${folder.id}`);
    }
    case 'rename_folder':
      await apiFetch('PATCH', `/api/folders/${args.id}`, { name: args.name });
      return ok(`Folder ${args.id} renamed to "${args.name}".`);
    case 'delete_folder':
      await apiFetch('DELETE', `/api/folders/${args.id}`);
      return ok(`Folder ${args.id} deleted.`);

    // --- contacts ---
    case 'list_contacts': {
      const rows = await apiFetch('GET', '/api/contacts');
      if (!rows.length) return ok('No contacts yet.');
      return ok(rows.map(fmtContact).join('\n'));
    }
    case 'add_contact': {
      const body = { email: args.email };
      if (args.alias !== undefined) body.alias = args.alias || null;
      const c = await apiFetch('POST', '/api/contacts', body);
      return ok(`Contact added: ${fmtContact(c)}`);
    }
    case 'update_contact': {
      const patch = {};
      if (args.alias !== undefined) patch.alias = args.alias || null;
      if (args.favorite !== undefined) patch.favorite = args.favorite;
      const c = await apiFetch('PATCH', `/api/contacts/${args.id}`, patch);
      return ok(`Contact updated: ${fmtContact(c)}`);
    }
    case 'remove_contact':
      await apiFetch('DELETE', `/api/contacts/${args.id}`);
      return ok(`Contact ${args.id} removed.`);

    // --- chat ---
    case 'list_conversations': {
      const rows = await apiFetch('GET', '/api/conversations');
      if (!rows.length) return ok('No conversations yet.');
      return ok(rows.map(fmtConversation).join('\n'));
    }
    case 'open_conversation': {
      if (!args.email && !args.userId) {
        throw new Error('open_conversation needs an email or a userId');
      }
      const body = args.email ? { email: args.email } : { userId: args.userId };
      const c = await apiFetch('POST', '/api/conversations/with', body);
      return ok(`Conversation ${c.id} with ${c.other.name} <${c.other.email}>`);
    }
    case 'list_messages': {
      const q = new URLSearchParams();
      if (args.before) q.set('before', args.before);
      if (args.limit !== undefined) q.set('limit', String(args.limit));
      const qs = q.toString();
      const data = await apiFetch(
        'GET',
        `/api/conversations/${args.conversationId}/messages${qs ? `?${qs}` : ''}`,
      );
      if (!data.items.length) return ok('No messages in this conversation.');
      const more = data.hasMore
        ? '\n\n(older messages exist — page back with "before" set to the earliest timestamp above)'
        : '';
      return ok(data.items.map(fmtMessage).join('\n') + more);
    }
    case 'send_message': {
      await apiFetch('POST', `/api/conversations/${args.conversationId}/messages`, {
        body: args.body,
      });
      return ok('Message sent.');
    }
    case 'send_note': {
      const body = { memoId: args.memoId };
      if (args.body !== undefined) body.body = args.body;
      await apiFetch(
        'POST',
        `/api/conversations/${args.conversationId}/messages`,
        body,
      );
      return ok(`Note ${args.memoId} sent and shared with the recipient.`);
    }

    // --- comments ---
    case 'list_comments': {
      const data = await apiFetch('GET', `/api/memos/${args.memoId}/comments`);
      if (!data.items.length) return ok('No comments on this note.');
      return ok(data.items.map(fmtComment).join('\n'));
    }
    case 'add_comment': {
      const c = await apiFetch('POST', `/api/memos/${args.memoId}/comments`, {
        body: args.body,
      });
      return ok(`Comment added: ${c.id}`);
    }
    case 'delete_comment':
      await apiFetch(
        'DELETE',
        `/api/memos/${args.memoId}/comments/${args.commentId}`,
      );
      return ok(`Comment ${args.commentId} deleted.`);

    // --- shared notes ---
    case 'list_shared_notes': {
      const rows = await apiFetch('GET', '/api/shared');
      if (!rows.length) return ok('No shared notes.');
      return ok(rows.map(fmtSharedNote).join('\n'));
    }

    default:
      throw new Error(`Tool ${name} not found`);
  }
}

async function handleRequest(message) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'noteshare-mcp', version: '3.1.0' },
    };
  }
  if (message.method === 'tools/list') return { tools: TOOLS };
  if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params;
    return callTool(name, args || {});
  }
  throw new Error(`Method ${message.method} not found`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.jsonrpc !== '2.0' || message.id === undefined) return;
  try {
    const result = await handleRequest(message);
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n',
    );
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: err.message },
      }) + '\n',
    );
  }
});
