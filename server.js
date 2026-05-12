const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY || 'your_new_key_here');

async function sendNtfy(message, tags = "speech_balloon") {
    try {
        await fetch("https://ntfy.sh/deskchat-adminpanel-asokwonye-2023", {
            method: 'POST',
            body: message,
            headers: { 'Title': 'Vehicle2U Chat', 'Tags': tags }
        });
    } catch (e) {
        console.error("ntfy failed");
    }
}

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ═══════════════════════════════════════════
// FILE-BASED PERSISTENCE
// ═══════════════════════════════════════════

const DATA_FILE = path.join(__dirname, 'chat-data.json');

// Load data from file
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        console.log('📂 Loaded chat data from file');
        return parsed;
    } catch (error) {
        console.log('📂 No existing data file, starting fresh');
        return { visitors: {} };
    }
}

// Save data to file
async function saveData(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('💾 Chat data saved to file');
    } catch (error) {
        console.error('❌ Failed to save data:', error);
    }
}

// ═══════════════════════════════════════════
// DATA STORES
// ═══════════════════════════════════════════

// Active visitors: visitorId -> { socketId, topicId, agent, messages[], email, name, isOnline }
const visitors = new Map();

// Admin sockets: socketId -> socket
const admins = new Map();

// Initialize data from file on startup
let persistedData = {};
(async () => {
    persistedData = await loadData();
    // Restore visitors from persisted data
    Object.entries(persistedData.visitors || {}).forEach(([visitorId, visitorData]) => {
        visitors.set(visitorId, {
            ...visitorData,
            socketId: null, // They're not connected yet
            isOnline: false,
            isTyping: false,
        });
    });
    console.log(`📊 Restored ${visitors.size} visitor conversations from storage`);
})();

// Auto-save data every 30 seconds
setInterval(async () => {
    const dataToSave = {
        visitors: {}
    };

    visitors.forEach((visitor, visitorId) => {
        dataToSave.visitors[visitorId] = {
            topicId: visitor.topicId,
            agent: visitor.agent,
            messages: visitor.messages,
            email: visitor.email,
            name: visitor.name,
            unreadCount: visitor.unreadCount || 0,
            connectedAt: visitor.connectedAt,
            hasLeft: visitor.hasLeft || false,
        };
    });

    await saveData(dataToSave);
}, 30000); // Save every 30 seconds

// Save immediately on critical events
async function saveImmediately() {
    const dataToSave = {
        visitors: {}
    };

    visitors.forEach((visitor, visitorId) => {
        dataToSave.visitors[visitorId] = {
            topicId: visitor.topicId,
            agent: visitor.agent,
            messages: visitor.messages,
            email: visitor.email,
            name: visitor.name,
            unreadCount: visitor.unreadCount || 0,
            connectedAt: visitor.connectedAt,
            hasLeft: visitor.hasLeft || false,
        };
    });

    await saveData(dataToSave);
}

// Generate unique topic ID
function generateTopicId() {
    return 'topic_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Get timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// Send email notification to offline visitor
async function sendEmailNotification(visitorEmail, visitorName, agentName, messageText) {
    try {
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 20px 40px; text-align: center; background: linear-gradient(135deg, #1a2b66 0%, #4963a9 100%); border-radius: 12px 12px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Vehicle2U España</h1>
                            <p style="margin: 8px 0 0 0; color: #e6ecff; font-size: 14px;">Compra y vende con confianza</p>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="margin: 0 0 20px 0; color: #1a2b66; font-size: 22px; font-weight: 600;">Hola ${visitorName || 'Cliente'},</h2>
                            <p style="margin: 0 0 20px 0; color: #4a5d8d; font-size: 16px; line-height: 1.6;">
                                <strong>${agentName}</strong> de nuestro equipo de soporte te ha enviado un mensaje:
                            </p>
                            
                            <!-- Message Box -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 30px 0;">
                                <tr>
                                    <td style="padding: 20px; background-color: #f8f3e0; border-left: 4px solid #d4a621; border-radius: 8px;">
                                        <p style="margin: 0; color: #1a1f3a; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${messageText}</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 0 0 25px 0; color: #4a5d8d; font-size: 16px; line-height: 1.6;">
                                Para continuar la conversación, haz clic en el botón de abajo:
                            </p>
                            
                            <!-- CTA Button -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td align="center" style="padding: 0;">
                                        <a href="https://vehicle2u-spain.onrender.com" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #1a2b66 0%, #4963a9 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(26, 43, 102, 0.3);">
                                            Continuar Conversación →
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e6ecff; border-radius: 0 0 12px 12px;">
                            <p style="margin: 0 0 10px 0; color: #6b7a9f; font-size: 13px; line-height: 1.6;">
                                Este correo fue enviado porque tienes una conversación activa con nuestro equipo de soporte.
                            </p>
                            <p style="margin: 0; color: #6b7a9f; font-size: 13px;">
                                © 2025 Vehicle2U España - BYRNECARS S.L. (NIF: B425473454)
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        await resend.emails.send({
            from: 'Vehicle2U Soporte <onboarding@resend.dev>',
            to: visitorEmail,
            subject: `💬 Nuevo mensaje de ${agentName} - Vehicle2U España`,
            html: emailHtml,
        });

        console.log(`📧 Email sent to ${visitorEmail}`);
        return true;
    } catch (error) {
        console.error('❌ Email send failed:', error);
        return false;
    }
}

// Broadcast chat list to all admins
function broadcastChatList() {
    const chatList = [];
    visitors.forEach((visitor, visitorId) => {
        chatList.push({
            visitorId: visitorId,
            topicId: visitor.topicId,
            agent: visitor.agent,
            messages: visitor.messages,
            lastMessage: visitor.messages.length > 0
                ? visitor.messages[visitor.messages.length - 1].text || '[Image]'
                : 'New visitor',
            time: visitor.messages.length > 0
                ? visitor.messages[visitor.messages.length - 1].time
                : getTimestamp(),
            unread: visitor.unreadCount || 0,
            isTyping: visitor.isTyping || false,
            connectedAt: visitor.connectedAt,
            email: visitor.email,
            name: visitor.name
        });
    });

    admins.forEach((socket) => {
        socket.emit('chat_list_update', chatList);
    });
}

// Send message to specific visitor
function sendToVisitor(visitorId, event, data) {
    const visitor = visitors.get(visitorId);
    if (visitor && visitor.socketId) {
        io.to(visitor.socketId).emit(event, data);
    }
}

// ═══════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        server: 'Vehicle2U Chat Server',
        activeVisitors: visitors.size,
        activeAdmins: admins.size,
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// ═══════════════════════════════════════════
// SOCKET.IO CONNECTION HANDLER
// ═══════════════════════════════════════════

io.on('connection', (socket) => {
    console.log(`🔌 New connection: ${socket.id}`);

    // ─── ADMIN REGISTRATION ───
    socket.on('admin_register', (data) => {
        console.log(`👑 Admin registered: ${socket.id}`, data?.name || 'Unknown');
        admins.set(socket.id, socket);
        socket.isAdmin = true;
        socket.adminName = data?.name || 'Admin';

        // Send current chat list to newly connected admin
        broadcastChatList();
    });

    // ─── VISITOR REGISTRATION ───
    socket.on('register', (data) => {
        const visitorId = data.odvisUserId;
        console.log(`👤 Visitor registered: ${visitorId}`);

        // Check if this visitor already exists (reconnection)
        const existingVisitor = visitors.get(visitorId);

        if (existingVisitor) {
            // Visitor reconnecting - restore their session
            existingVisitor.socketId = socket.id;
            existingVisitor.isOnline = true;
            existingVisitor.hasLeft = false;
            socket.visitorId = visitorId;

            // Send them their assigned agent if they have one
            if (existingVisitor.agent) {
                socket.emit('agent_assigned', existingVisitor.agent);
            }

            // Send any messages they missed while offline
            existingVisitor.messages.forEach(msg => {
                if (msg.isAgent && msg.sentWhileOffline) {
                    sendToVisitor(visitorId, 'admin_message', {
                        text: msg.text,
                        avatar: existingVisitor.agent?.avatar || 'https://via.placeholder.com/150'
                    });
                    msg.sentWhileOffline = false; // Mark as delivered
                }
            });

            console.log(`🔄 Visitor reconnected: ${visitorId} (${existingVisitor.messages.length} messages restored)`);
            broadcastChatList();
            saveImmediately();
            return;
        }

        // New visitor
        const topicId = generateTopicId();

        visitors.set(visitorId, {
            socketId: socket.id,
            topicId: topicId,
            agent: null,
            messages: [],
            unreadCount: 0,
            isTyping: false,
            hasLeft: false,
            isOnline: true,
            email: null,
            name: null,
            connectedAt: Date.now()
        });

        socket.visitorId = visitorId;
        socket.emit('topic_created', topicId);

        broadcastChatList();
        saveImmediately();
    });

    // ─── VISITOR PROVIDES EMAIL & NAME ───
    socket.on('visitor_info', (data) => {
        const visitorId = socket.visitorId;
        if (!visitorId) return;

        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        visitor.email = data.email;
        visitor.name = data.name;

        console.log(`✉️ Visitor ${visitorId} provided info: ${data.name} (${data.email})`);
        saveImmediately();
    });

    // ─── VISITOR SENDS MESSAGE ───
    socket.on('user_message', (text) => {
        const visitorId = socket.visitorId;
        if (!visitorId) return;

        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        const message = {
            id: Date.now(),
            text: text,
            isAgent: false,
            time: getTimestamp(),
            type: 'text'
        };

        visitor.messages.push(message);
        sendNtfy(`Nuevo mensaje de ${visitorId.slice(-4)}: ${text}`);
        visitor.unreadCount = (visitor.unreadCount || 0) + 1;
        visitor.isTyping = false;

        console.log(`💬 Visitor ${visitorId}: ${text}`);

        // Notify all admins (even if offline, message is saved)
        admins.forEach((adminSocket) => {
            adminSocket.emit('visitor_message', {
                visitorId: visitorId,
                message: message
            });
        });

        broadcastChatList();
        saveImmediately();
    });

    // ─── VISITOR SENDS IMAGE ───
    socket.on('user_image', (data) => {
        const visitorId = socket.visitorId;
        if (!visitorId) return;

        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        const message = {
            id: Date.now(),
            text: data.text || '',
            isAgent: false,
            time: getTimestamp(),
            type: 'image',
            imageUrl: data.base64
        };

        visitor.messages.push(message);
        sendNtfy(`El visitante ${visitorId.slice(-4)} envió una imagen`, "camera");
        visitor.unreadCount = (visitor.unreadCount || 0) + 1;
        visitor.isTyping = false;

        console.log(`📷 Visitor ${visitorId} sent image`);

        admins.forEach((adminSocket) => {
            adminSocket.emit('visitor_message', {
                visitorId: visitorId,
                message: message
            });
        });

        broadcastChatList();
        saveImmediately();
    });

    // ─── VISITOR TYPING ───
    socket.on('visitor_typing', (isTyping) => {
        const visitorId = socket.visitorId;
        if (!visitorId) return;

        const visitor = visitors.get(visitorId);
        if (visitor) {
            visitor.isTyping = isTyping;
        }

        admins.forEach((adminSocket) => {
            adminSocket.emit('visitor_typing_update', {
                visitorId: visitorId,
                isTyping: isTyping
            });
        });
    });

    // ─── ADMIN SENDS MESSAGE ───
    socket.on('admin_message', async (data) => {
        const { visitorId, text } = data;
        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        const agent = visitor.agent;
        const message = {
            id: Date.now(),
            text: text,
            isAgent: true,
            time: getTimestamp(),
            type: 'text',
            agentName: agent?.name || 'Agent',
            sentWhileOffline: !visitor.isOnline
        };

        visitor.messages.push(message);

        console.log(`📤 Admin -> Visitor ${visitorId}: ${text} ${!visitor.isOnline ? '(OFFLINE - SAVED)' : ''}`);

        // Check if visitor is online
        if (visitor.isOnline && visitor.socketId) {
            // Visitor is online - send via Socket.io
            sendToVisitor(visitorId, 'admin_message', {
                text: text,
                avatar: agent?.avatar || 'https://via.placeholder.com/150'
            });
            message.sentWhileOffline = false; // Mark as delivered
        } else if (visitor.email) {
            // Visitor is offline and has email - send email notification
            console.log(`📧 Visitor ${visitorId} is offline, sending email to ${visitor.email}`);
            await sendEmailNotification(
                visitor.email,
                visitor.name || 'Cliente',
                agent?.name || 'Soporte Vehicle2U',
                text
            );
        } else {
            console.log(`💾 Visitor ${visitorId} is offline, message saved for later delivery`);
        }

        // Notify other admins about the new message
        admins.forEach((adminSocket) => {
            adminSocket.emit('admin_message_sent', {
                visitorId: visitorId,
                message: message
            });
        });

        broadcastChatList();
        saveImmediately();
    });

    // ─── ADMIN SENDS IMAGE ───
    socket.on('admin_image', (data) => {
        const { visitorId, base64, text } = data;
        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        const agent = visitor.agent;
        const message = {
            id: Date.now(),
            text: text || '',
            isAgent: true,
            time: getTimestamp(),
            type: 'image',
            imageUrl: base64,
            agentName: agent?.name || 'Agent',
            sentWhileOffline: !visitor.isOnline
        };

        visitor.messages.push(message);

        if (visitor.isOnline && visitor.socketId) {
            sendToVisitor(visitorId, 'admin_image', {
                text: text || '',
                avatar: agent?.avatar || 'https://via.placeholder.com/150',
                url: base64
            });
            message.sentWhileOffline = false;
        }

        admins.forEach((adminSocket) => {
            adminSocket.emit('admin_message_sent', {
                visitorId: visitorId,
                message: message
            });
        });

        broadcastChatList();
        saveImmediately();
    });

    // ─── ADMIN TYPING ───
    socket.on('admin_typing', (data) => {
        const { visitorId, isTyping } = data;
        sendToVisitor(visitorId, 'admin_typing', isTyping);
    });

    // ─── ADMIN MARKS CHAT AS READ ───
    socket.on('mark_read', (visitorId) => {
        const visitor = visitors.get(visitorId);
        if (visitor) {
            visitor.unreadCount = 0;
            broadcastChatList();
            saveImmediately();
        }
    });

    // ─── AGENT TRANSFER / ASSIGNMENT ───
    socket.on('transfer_agent', (data) => {
        const { visitorId, agent } = data;
        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        console.log(`🔄 Agent transfer for ${visitorId}: ${agent.name} (${agent.department})`);

        // Tell the visitor "waiting for agent"
        sendToVisitor(visitorId, 'waiting_for_agent', {});

        // After a delay, assign the new agent
        setTimeout(() => {
            visitor.agent = agent;

            // Tell the visitor about the new agent
            sendToVisitor(visitorId, 'agent_assigned', agent);

            // Add a system message
            const systemMsg = {
                id: Date.now(),
                text: `${agent.name} (${agent.department}) se ha unido al chat.`,
                isAgent: true,
                time: getTimestamp(),
                type: 'system'
            };
            visitor.messages.push(systemMsg);

            // Notify admins
            admins.forEach((adminSocket) => {
                adminSocket.emit('agent_transferred', {
                    visitorId: visitorId,
                    agent: agent
                });
            });

            broadcastChatList();
            saveImmediately();
        }, 3000);
    });

    // ─── ADMIN SENDS DOCUMENT WIDGET ───
    socket.on('send_document_widget', (data) => {
        const { visitorId } = data;
        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        if (visitor.isOnline && visitor.socketId) {
            sendToVisitor(visitorId, 'custom_widget', 'document');
        }

        const message = {
            id: Date.now(),
            text: '[Documento enviado]',
            isAgent: true,
            time: getTimestamp(),
            type: 'widget_document',
            sentWhileOffline: !visitor.isOnline
        };
        visitor.messages.push(message);

        admins.forEach((adminSocket) => {
            adminSocket.emit('admin_message_sent', {
                visitorId: visitorId,
                message: message
            });
        });

        broadcastChatList();
        saveImmediately();
    });

    // ─── ADMIN SENDS LINK WIDGET ───
    socket.on('send_link_widget', (data) => {
        const { visitorId, url } = data;
        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        if (visitor.isOnline && visitor.socketId) {
            sendToVisitor(visitorId, 'link_widget', { url: url });
        }

        const message = {
            id: Date.now(),
            text: `[Enlace: ${url}]`,
            isAgent: true,
            time: getTimestamp(),
            type: 'widget_link',
            sentWhileOffline: !visitor.isOnline
        };
        visitor.messages.push(message);

        admins.forEach((adminSocket) => {
            adminSocket.emit('admin_message_sent', {
                visitorId: visitorId,
                message: message
            });
        });

        broadcastChatList();
        saveImmediately();
    });

    // ─── ADMIN ENDS CHAT ───
    socket.on('end_chat', (visitorId) => {
        const visitor = visitors.get(visitorId);
        if (!visitor) return;

        console.log(`🔚 Chat ended for visitor: ${visitorId}`);

        // Notify the visitor
        sendToVisitor(visitorId, 'chat_ended', {});

        // Mark as ended but keep the data
        visitor.hasLeft = true;
        visitor.isOnline = false;
        visitor.socketId = null;

        broadcastChatList();
        saveImmediately();
    });

    // ─── PING/PONG KEEPALIVE ───
    socket.on('ping_server', () => {
        socket.emit('pong_server');
    });

    // ─── VISITOR LEFT ───
    socket.on('visitor_left', () => {
        if (socket.visitorId) {
            const visitor = visitors.get(socket.visitorId);
            if (visitor) {
                visitor.hasLeft = true;
                saveImmediately();
            }
            sendNtfy(`Sesión finalizada por el visitante ${socket.visitorId.slice(-4)}`, "door");
        }
    });

    // ─── DISCONNECT ───
    socket.on('disconnect', (reason) => {
        console.log(`❌ Disconnected: ${socket.id} (${reason})`);

        // If admin disconnected
        if (socket.isAdmin) {
            admins.delete(socket.id);
            console.log(`👑 Admin disconnected. Active admins: ${admins.size}`);
        }

        // If visitor disconnected - keep their data, mark as offline
        if (socket.visitorId) {
            const visitor = visitors.get(socket.visitorId);
            if (visitor) {
                visitor.socketId = null;
                visitor.isOnline = false;
                console.log(`👤 Visitor ${socket.visitorId} disconnected (data preserved - ${visitor.messages.length} messages)`);

                // Don't auto-cleanup - keep data permanently unless admin ends chat
                broadcastChatList();
                saveImmediately();
            }
        }
    });
});

// Save data on server shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Server shutting down, saving data...');
    await saveImmediately();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Server shutting down, saving data...');
    await saveImmediately();
    process.exit(0);
});

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 Vehicle2U Chat Server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Status: http://localhost:${PORT}/\n`);
});
