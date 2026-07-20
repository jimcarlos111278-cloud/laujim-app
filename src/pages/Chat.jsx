import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Send, Users, ChevronLeft } from 'lucide-react';
import { getAuth } from '../utils/auth';
import { getAllRooms, getRoomMessages, sendMessage, sendHeartbeat, startChatPoll, stopChatPoll, startHeartbeat, startPresencePoll, stopPresencePoll, getStatusLabel } from '../utils/chat';

export default function Chat() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [presence, setPresence] = useState([]);
  const bottomRef = useRef(null);
  const userId = auth?.role === 'admin' ? 'admin' : (auth?.username || 'apt-' + auth?.apartmentId);

  useEffect(() => {
    if (!auth) { navigate('/login', { replace: true }); return; }
    getAllRooms(auth).then(r => { setRooms(r); if (r.length > 0) selectRoom(r[0]); });
    startChatPoll(newMsgs => {
      if (activeRoom && newMsgs.some(m => m.roomId === activeRoom.id)) {
        getRoomMessages(activeRoom.id).then(setMessages);
      }
    }, 3000);
    startHeartbeat(userId, 10000);
    startPresencePoll(data => setPresence(data || []), 5000);
    const onHide = () => sendHeartbeat(userId, 'offline');
    const onVis = () => sendHeartbeat(userId, document.hidden ? 'away' : 'online');
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopChatPoll(); stopHeartbeat(); stopPresencePoll();
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function selectRoom(room) {
    setActiveRoom(room);
    setShowSidebar(false);
    getRoomMessages(room.id).then(setMessages);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !activeRoom) return;
    setInput('');
    const to = activeRoom.type === 'group' ? 'todos' : (activeRoom.id.includes('admin') ? 'admin' : '');
    await sendMessage(activeRoom.id, userId, to, text);
    getRoomMessages(activeRoom.id).then(setMessages);
  }

  function getRoomStatus(room) {
    if (room.type === 'group') return null;
    const id = room.id.startsWith('admin-') ? room.id.slice(6) : null;
    if (!id) return null;
    const target = userId === 'admin' ? id : 'admin';
    if (target === id && userId !== 'admin') return null;
    return getStatusLabel(presence, target === 'admin' ? 'admin' : id);
  }

  function getOnlineCount() {
    return presence.filter(p => {
      const elapsed = Date.now() - new Date(p.lastSeen).getTime();
      return p.status === 'online' && elapsed < 15000;
    }).length;
  }

  if (!auth) return null;

  return (
    <div className="flex h-[calc(100vh-6rem)] bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Sidebar */}
      <div className={`w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 ${showSidebar ? 'block' : 'hidden'} md:block`}>
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageCircle className="w-4 h-4" /> Chat
            <span className="text-xs font-normal text-gray-400">({getOnlineCount()} en línea)</span>
          </h2>
        </div>
        <div className="overflow-y-auto h-[calc(100%-3rem)]">
          {rooms.map(room => {
            const status = getRoomStatus(room);
            return (
              <button key={room.id} onClick={() => selectRoom(room)} className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${activeRoom?.id === room.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                <div className="flex items-center gap-2">
                  {room.type === 'group' ? <Users className="w-4 h-4 flex-shrink-0" /> : <MessageCircle className="w-4 h-4 flex-shrink-0" />}
                  <span className="truncate flex-1">{room.label}</span>
                  {status && <span className={`w-2 h-2 rounded-full ${status.dot} flex-shrink-0`} title={status.label} />}
                </div>
                {status && <div className="text-[10px] text-gray-400 pl-6">{status.label}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeRoom ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <button onClick={() => setShowSidebar(true)} className="md:hidden p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="font-medium text-gray-900 dark:text-white">{activeRoom.label}</span>
              <span className="text-xs text-gray-400">{activeRoom.type === 'group' ? 'Grupal' : 'Privado'}</span>
              {(() => { const s = getRoomStatus(activeRoom); return s ? <span className={`w-2 h-2 rounded-full ${s.dot}`} title={s.label} /> : null; })()}
            </div>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 text-sm mt-8">No hay mensajes aún. ¡Escribe algo!</div>
              )}
              {messages.map(msg => {
                const isMine = msg.from === userId;
                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${isMine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-sm'}`}>
                      {activeRoom.type === 'group' && !isMine && (
                        <div className="text-xs font-medium mb-0.5 text-blue-400">{msg.from}</div>
                      )}
                      <div>{msg.content}</div>
                      <div className={`text-xs mt-1 ${isMine ? 'text-blue-200' : 'text-gray-400'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            {/* Input */}
            <form onSubmit={handleSend} className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              <button type="submit" disabled={!input.trim()} className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Selecciona una sala</div>
        )}
      </div>
    </div>
  );
}
