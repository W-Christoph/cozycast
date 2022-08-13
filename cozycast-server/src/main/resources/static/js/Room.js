import { Component, render } from '/js/libs/preact.js'
import { html } from '/js/libs/htm/preact/index.js'

import { RoomSidebar } from '/js/RoomSidebar.js'
import { ProfileModal } from '/js/ProfileModal.js'
import { ScheduleSidebar, openSchedule } from '/js/ScheduleSidebar.js'
import { Userlist } from '/js/Userlist.js'

import { VideoControls } from '/js/VideoControls.js'
import { Controls } from '/js/Controls.js'
import { SidebarState, WorkerStatus } from '/js/index.js'
import { UserHoverName } from '/js/UserHoverName.js'
import { typing, filterTyping, clearTyping } from '/js/ChatInput.js'


var favicon = new Favico({
    animation:'none'
});

let idleTimer = null;
let idleState = false;
export function removeCursor(e) {
  let time = 1500;
  clearTimeout(idleTimer);
  if (idleState == true) {
    document.getElementById("pagetoolbar").classList.remove("hideToolbar");
    document.getElementById("videoBig").classList.remove("hideCursor");
  }
  idleState = false;
  idleTimer = setTimeout(function() {
    if(document.fullscreenElement == null) return;
    document.getElementById("pagetoolbar").classList.add("hideToolbar");
    document.getElementById("videoBig").classList.add("hideCursor");
    idleState = true;
  }, time);
}

export class Room extends Component {
    constructor(props) {
        super(props);
        //state setup
        let volume = parseInt(localStorage.getItem("volume"));
            if(!isNaN(volume)) volume = Math.max(Math.min(volume,100),0);
            else volume = 100;
        let roomId = props.roomId;
        this.state = {
            roomId: roomId,
            roomToken: localStorage.getItem("room-" + roomId + "-token"),
            userlist: [],
            roomlist: [],
            chatMessages: [],
            newMessage: false,
            forceChatScroll: false,
            remote: false,
            remoteUsed: false,
            username: localStorage.hasOwnProperty("username") ? localStorage.getItem("username"): "Anonymous",
            avatarUrl: localStorage.hasOwnProperty("avatarUrl") ? localStorage.getItem("avatarUrl") : '/png/default_avatar.png',
            volume: volume,
            videoPaused: true,
            videoLoading: false,
            viewPort: {
                width: 1280,
                height: 720,
            },
            roomSidebar: SidebarState.CHAT,
            workerStatus: WorkerStatus.STARTED,
            roomSettings: {
                workerStarted: true,
                desktopResolution: 720,
                streamResolution: 720,
                framerate: 25,
                videoBitrate: 1000,
                audioBitrate: 96,
                accessType: "public",
                centerRemote: false
            },
            session: null,
            windowTitle: "CozyCast: Low latency screen capture via WebRTC",
            historyMode: false,
            fullscreen: false,
            kicked: false,
            banned: localStorage.getItem("banned"),
            newMessageCount: 0,
            scheduleSidebar: false,
            scheduleMenu: "ROOM_AVAILABILITY",
            editSchedule: {
                days: []
            },
            userlistHidden: false,
            muteChatNotification: localStorage.hasOwnProperty('muteChatNotification') ?  localStorage.getItem("muteChatNotification") == 'true' : true,
            showUsernames: localStorage.hasOwnProperty('showUsernames') ?  localStorage.getItem("showUsernames") == 'true' : true,
            legacyDesign: localStorage.hasOwnProperty('legacyDesign') ?  localStorage.getItem("legacyDesign") == 'true' : false,
            muted: localStorage.hasOwnProperty('muted') ?  localStorage.getItem("muted") == 'true' : false,
            showIfMuted: localStorage.hasOwnProperty('showIfMuted') ?  localStorage.getItem("showIfMuted") == 'true' : false,
            userlistOnLeft: localStorage.hasOwnProperty('userlistOnLeft') ?  localStorage.getItem("userlistOnLeft") == 'true' : false,
            websocket: null,
            webRtcPeer: null
        };
        //check if valid profile picture was used and replace if not
        if(this.state != '/png/default_avatar.png'){
            fetch(this.state.avatarUrl).then((e) => {
                if(e.status != 200) {
                    this.setState({
                        avatarUrl: '/png/default_avatar.png'
                    })
                }
            })
        }
        //bind function so they can be passed down as props
        this.pauseVideo = this.pauseVideo.bind(this)
        this.sendMessage = this.sendMessage.bind(this)
        this.updateRoomState = this.updateRoomState.bind(this)
    }

    //lets children change room state
    updateRoomState = this.setState;

    componentDidMount() {
        document.onvisibilitychange = () => {
            if(!document.hidden){
                this.setState({
                    newMessageCount: 0
                })
                favicon.badge(0);
            }
        }
        //if no websocket present create a new one
        if(!this.state.websocket) this.connect(this.props.roomId)
        
        window.onbeforeunload = () => {
            if(this.state.websocket) {
                this.state.websocket.close();
            }
        }

        document.addEventListener('fullscreenchange', (event) => {
            if(document.fullscreenElement == null){
                  document.getElementById("videoBig").removeEventListener('mousemove',removeCursor);
            };
            this.setState({
                fullscreen: document.fullscreenElement !== null
            })
        });
    }

    componentWillUnmount() {
        this.state.websocket.close();
    }

    componentDidUpdate() {
        document.title = this.state.windowTitle
    }

    pauseVideo = (e) => {
        let updatedPaused = !this.state.videoPaused;
        if(updatedPaused) {
            var videoElement = document.getElementById('video');
            videoElement.pause();
            this.webrtc_stop();
        } else {
            var videoElement = document.getElementById('video');
            videoElement.play();
            this.webrtc_start();
        }
        if(this.state.showIfMuted) {
            this.sendMessage({
                action : 'userMuted',
                muted: this.state.muted || updatedPaused
            });
        }
        this.setState({videoPaused: updatedPaused})
    }
    
    inactiveTimer = null;
    active = true;
    calcActiveStatus = (tabbedOut) => {
      let time = 5 * 60 * 1000;
      if(!tabbedOut){
        clearTimeout(this.inactiveTimer);
        this.inactiveTimer = null;
        if(!this.active){
            this.active = true;
            this.sendActivityStatus();
        }
      }
      else {
        if(this.inactiveTimer != null) return;
        this.inactiveTimer = setTimeout(() => {
          this.active = false;
          this.sendActivityStatus();
        }, time);
      }
    }
    
    sendActivityStatus = () => {
        this.sendMessage({
            action : 'userActivity',
            tabbedOut: !this.active,
        });
    }
    
    //deletes messages based on id and leaves a deleted in its place, the deleted symbol is client side only
    deletemessage = (parsedMessage) => {
        this.setState({
            chatMessages:
                this.state.chatMessages.map(function(message) {
                    message.data = message.data.map(data => {
                            if(data.id == parsedMessage.id){
                                return {
                                    ...data,
                                    messages: [{
                                            href: "",
                                            message: "",
                                            type: "deleted"
                                        }],
                                    msg: "",
                                    deleted: true
                                }
                            }
                            return data;
                            });
                return message;
                }),
            newMessage: false
        })
    }

    editmessage = (parsedMessage) => {
        var msg = parsedMessage.message || "";
        this.setState({
            chatMessages:
                this.state.chatMessages.map((message) => {
                    message.data = message.data.map(data => {
                            if(data.id == parsedMessage.id){
                                return {
                                    ...data,
                                    messages: this.parseMessage(parsedMessage),
                                    msg: msg,
                                    edited: true
                                }
                            }
                            return data;
                            });
                return message;
                }),
            newMessage: true
        })
    }

    //fully deletes a message based on id
    completeDeletemessage = (parsedMessage) => {
        this.setState({chatMessages:    
            this.state.chatMessages.map(function(message) {
                if(message.data.length == 1 && message.data[0].id == parsedMessage.id) {return};
                message.data = message.data.filter(data => data.id != parsedMessage.id);
                return message;
            }).filter(x=>x),
            newMessage: false
        })
    }


    parseMessage = (parsedMessage) => {
        var msg = parsedMessage.message || "";
        var queuedMessages = [];
        if(parsedMessage.type == "video") {
            queuedMessages.push({ "type": "video", "href": parsedMessage.image });
        } else if(parsedMessage.type == "image") {
            queuedMessages.push({ "type": "image", "href": parsedMessage.image });
        } else {
            var offset = 0;
            var urls = linkify.find(msg);
            var remaining = msg;
            urls.forEach(function(element) {
                var end = remaining.indexOf(element.value, offset);
                if(offset != end) {
                    queuedMessages.push({ "type": "text", "message": remaining.substring(offset, end) });
                }
                if(element.value.indexOf("http") != -1) {
                    queuedMessages.push({ "type": "url", "href": element.value });
                } else {
                    queuedMessages.push({ "type": "text", "message": element.value });
                }
                offset = end + element.value.length;
            });
            if(offset < remaining.length) {
                queuedMessages.push({ "type": "text", "message": remaining.substring(offset, remaining.length) });
            }
        }
        return queuedMessages;
    }

    /* parses the chatHistory in the messages array used in states. Called once upon entering a room. 
    Faster since it only calls setState once with the entire chat history*/
    chatHistory = (allMessages) => {
        var list = [];
        allMessages.slice().reverse().forEach(parsedMessage => {
            var msg = parsedMessage.message || "";
            var queuedMessages = this.parseMessage(parsedMessage);
            var timestamp = moment(parsedMessage.timestamp).format('h:mm A');
            if(list.length > 0 && list[list.length-1].session == parsedMessage.session) {
                var lastMessage = list[list.length-1];
                lastMessage.data.push({messages: queuedMessages, id: parsedMessage.id, timestamp: timestamp, edited: parsedMessage.edited})
            } else {
                list.push({
                    username: parsedMessage.username,
                    session: parsedMessage.session,
                    data: [{messages: queuedMessages, id: parsedMessage.id, timestamp: timestamp, msg: msg, edited: parsedMessage.edited}]
                })
            }
        } )
        this.setState({
            newMessage: true, 
            chatMessages: list,
            forceChatScroll: true
        })
    }
    
    chatmessage = (parsedMessage, skip_notifications) => {
        var msg = parsedMessage.message || "";
        var queuedMessages = this.parseMessage(parsedMessage);

        var list;
        if(this.state.chatMessages.length > 0 && this.state.chatMessages[this.state.chatMessages.length-1].session == parsedMessage.session) {
            var lastMessageID = this.state.chatMessages[this.state.chatMessages.length-1].data[0].id;
            list = this.state.chatMessages.map((message) => {
                if(message.data[0].id === lastMessageID){
                    const updatedMessage = {
                        ...message,
                        data: [...message.data,{messages: queuedMessages, id: parsedMessage.id, timestamp:moment(parsedMessage.timestamp).format('h:mm A'),msg: msg, edited: parsedMessage.edited}]
                    }
                    return updatedMessage;
                }
                return message;
            })
        } else {
            list = [...this.state.chatMessages, {
                username: parsedMessage.username,
                session: parsedMessage.session,
                data: [{messages: queuedMessages, id: parsedMessage.id, timestamp:moment(parsedMessage.timestamp).format('h:mm A'),msg: msg, edited: parsedMessage.edited}]
            }]
        }
        this.setState({
            newMessage: true, 
            chatMessages: list
        })

        if(skip_notifications) {
            return
        }

        var lowerCaseMsg = msg.toLowerCase()
        var pattern = "@" + this.state.username.toLowerCase()
        var mentionPos = lowerCaseMsg.indexOf(pattern)
        var lookahead = lowerCaseMsg.substring(mentionPos, (pattern + " ").length).trim()
        var mention = lookahead == pattern
        if (this.state.historyMode || mention || !this.state.muteChatNotification && document.hidden && parsedMessage.session !== this.state.session) {
            var audio = new Audio('/audio/pop.wav');
            audio.play();
        }

        if(document.hidden) {
            this.setState({newMessageCount: this.state.newMessageCount + 1 })
            favicon.badge(this.state.newMessageCount + 1);
        }

    }
    
    join = (parsedMessage) => {
        this.leave(parsedMessage)
        this.setState({
            userlist: [...this.state.userlist, {
                username: parsedMessage.username,
                url: parsedMessage.url,
                session: parsedMessage.session,
                remote: false,
                lastTimeSeen: moment(parsedMessage.lastTimeSeen).format('h:mm A'),
                active: parsedMessage.active,
                muted: parsedMessage.muted
            }]
        })
    }
    
    updateActivity = (parsedMessage) => {
        this.setState({
            userlist: this.state.userlist.map(function(element) {
                if(element.session == parsedMessage.session) {
                    const updatedElement = {
                        ...element,
                        active: parsedMessage.active,
                        lastTimeSeen:  moment(parsedMessage.lastTimeSeen).format('h:mm A')
                    }
                    return updatedElement;
                }
                return element;
            })
        })
    }
    
    updateMuted = (parsedMessage) => {
        this.setState({
            userlist: this.state.userlist.map(function(element) {
                if(element.session == parsedMessage.session) {
                    const newElement = {
                        ...element,
                        muted:  parsedMessage.muted
                    }
                    return newElement;
                }
                return element;
            })
        })
    }
    
    changeusername = (parsedMessage) => {
        this.setState({
            userlist: this.state.userlist.map(function(element) {
                if(element.session == parsedMessage.session) {
                    return {
                        ...element,
                        username: parsedMessage.username
                    }
                }
                return element;
            }),
            chatMessages: this.state.chatMessages.map(function(message) {
                if(message.session == parsedMessage.session)
                    return {
                        ...message,
                        username: parsedMessage.username
                    }
                return message;
            })
        })
    }
    
    changeprofilepicture = (parsedMessage) => {
        this.setState({
            userlist: this.state.userlist.map(function(element) {
                if(element.session == parsedMessage.session) {
                    return {
                        ...element,
                        url: parsedMessage.url
                    }
                }
                return element;
            })
            }
        )
    }
    
    leave = (parsedMessage) => {
        this.setState({
            userlist: this.state.userlist.filter(function(element) {
                return element.session != parsedMessage.session;
            })
        })
        filterTyping(parsedMessage.session);
    }
    
    ban = (parsedMessage) => {
        if(parsedMessage.session == this.state.session) {
            localStorage.setItem("banned", parsedMessage.expiration);
            this.setState({
                banned: parsedMessage.expiration
            })
            this.state.websocket.close();
        }
    }
    
    isBanned = () => {
        if(this.state.banned == null) {
            return false;
        }
        if(this.state.banned == "unlimited") {
            return true
        } else {
            var expiration = new Date(this.state.banned)
            if(new Date().getTime() < expiration.getTime()) {
                return true
            }
        }
        return false
    }
    
    keepAlive;
    connect = (room) => {
        if(this.isBanned()) {
            return;
        }
        var wsProtocol = 'wss'
        if(document.location.protocol != 'https:') {
            wsProtocol = 'ws'
        }
        let newWebsocket = new WebSocket(wsProtocol + '://' + location.host + '/player/' + room);
        newWebsocket.onmessage = (message) => {
            var parsedMessage = JSON.parse(message.data);
            console.log(parsedMessage)
            switch (parsedMessage.action) {
                case 'keepalive':
                    break;
                case 'ban':
                    this.ban(parsedMessage)
                    break;
                case 'session_id':
                    this.setState({
                        session: parsedMessage.session
                    })
                    break;
                case 'startResponse':
                    this.startResponse(parsedMessage);
                    break;
                case 'error':
                    console.log('Error from server: ' + parsedMessage.message);
                    break;
                case 'typing':
                    typing(parsedMessage);
                    break;
                case 'userActivityChange':
                    this.updateActivity(parsedMessage);
                    break;
                case 'userMutedChange':
                    this.updateMuted(parsedMessage);
                    break;
                case 'chat_history':
                    //TODO: optimize this
                    if(parsedMessage.messages) {
                        this.chatHistory(parsedMessage.messages)
                    }
                    break;
                case 'receivemessage':
                    this.chatmessage(parsedMessage);
                    break;
                case 'deletemessage':
                    this.deletemessage(parsedMessage);
                    break;
                case 'editmessage':
                    this.editmessage(parsedMessage);
                    break;
                case 'changeusername':
                    this.changeusername(parsedMessage);
                    break;
                case 'changeprofilepicture':
                    this.changeprofilepicture(parsedMessage);
                    break;
                case 'join':
                    this.join(parsedMessage);
                    break;
                case 'leave':
                    this.leave(parsedMessage);
                    break;
                case 'drop_remote':
                    this.setState({
                        remote: false,
                        remoteUsed: false,
                        userlist: this.state.userlist.map((user) => {
                            if(user.session == parsedMessage.session) {
                                return {
                                    ...user,
                                    remote: false
                                }
                            }
                            return user;
                        })
                    })
                    break;
                case 'pickup_remote':
                    this.setState({
                        remote: parsedMessage.has_remote,
                        remoteUsed: !parsedMessage.has_remote,
                        userlist: this.state.userlist.map((user) => {
                            return {
                                ...user,
                                remote: user.session == parsedMessage.session
                            }
                        })
                    })
                    break;
                case 'window_title':
                    this.setState({windowTitle: parsedMessage.title})
                    break;
                case 'iceCandidate':
                    this.state.webRtcPeer.addIceCandidate(parsedMessage.candidate, function(error) {
                        if (error) {
                            console.log('Error iceCandidate: ' + error);
                            return;
                        } else {
                            console.log("Successful iceCandidate")
                        }
                    });
                    break;
                default:
                    console.log('Unknown action: ', parsedMessage);
            }
        }
        newWebsocket.onclose = (event) => {
            this.setState({
                userlist: [],
                chatMessages: [],
                remote: false
            })
            clearTyping();
            this.webrtc_stop()
            clearInterval(this.keepAlive)
            this.keepAlive = null;
            setTimeout(() => this.connect(room), 1500)
        }
      
        newWebsocket.onopen = (event) => {
            setTimeout(() => {
                this.start();
                document.addEventListener("visibilitychange", () => {
                    this.calcActiveStatus(document.visibilityState != "visible");
                  });
            }, 300);
        };

        this.setState({
            websocket: newWebsocket,
            roomId: room
        })
      
        this.keepAlive = setInterval(() => {
            this.sendMessage({
                action : 'keepalive',
            });
        }, 30000);
    }
    
    start = () => {
        this.sendMessage({
            action : 'join',
            username: this.state.username,
            url: this.state.avatarUrl,
            token: this.state.roomToken,
            muted: (this.state.showIfMuted ? this.state.muted : false)
        });
        this.webrtc_start()
    }
    
    webrtc_start = () => {
        fetch("/turn/credential").then((e) => e.json()).then((iceServer) => {
            var options = {
                remoteVideo : document.getElementById("video"),
                mediaConstraints : {
                    audio : true,
                    video : true
                },
                onicecandidate : this.onIceCandidate,
                configuration: {
                    iceServers: [iceServer]
                }
            }
          
            this.setState({webRtcPeer: new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
                (error) => {
                    if (error) {
                        console.log(error);
                        return;
                    }
                    this.state.webRtcPeer.generateOffer(this.onOffer);
                })})
        });
    }
    
    webrtc_stop = () => {
        if (this.state.webRtcPeer) {
            this.state.webRtcPeer.dispose();
            this.setState({
                webRtcPeer: null
            })
        }
    }
    
    onOffer = (error, sdpOffer) => {
        if (error) {
            console.log(error);
            return;
        }
      
        this.sendMessage({
            action : 'start',
            sdpOffer : sdpOffer
        });
    }
    
    onIceCandidate = (candidate) => {
        this.sendMessage({
            action : 'onIceCandidate',
            candidate : candidate
        });
    }
    
    startResponse = (message) => {
        this.state.webRtcPeer.processAnswer(message.sdpAnswer, (error) => {
            if (error) {
                console.log(error);
                return;
            }
        });
        var settings = message.videoSettings
        this.setState({
            viewPort: { width: settings.desktopWidth,
                height: settings.desktopHeight
            },
            roomSettings: {
                ...this.state.roomSettings,
                desktopResolution: settings.desktopHeight,
                streamResolution: settings.scaleHeight,
                framerate: settings.framerate,
                videoBitrate: settings.videoBitrate,
                audioBitrate: settings.audioBitrate
            }
        }
        )
    }
    
    sendMessage = (message) => {
        this.state.websocket.send(JSON.stringify(message));
    }

    render({ roomId }, state) {
    return html`
        <div id="pagecontent" class="${state.legacyDesign ? "legacyDesign" : "noiseBackground defaultDesign"}">
            ${this.isBanned() && html`Banned until ${state.banned}`}
            ${!this.isBanned() && html`
            ${!state.userlistHidden && !state.fullscreen && state.userlistOnLeft && html`<div><${Userlist} showUsernames=${state.showUsernames} userlist=${state.userlist} isLeft=${true} updateRoomState=${this.updateRoomState}/></div>`}
            <div id="contentWithoutSidebar" class="contentWithoutSidebar">
                <${VideoControls} state=${state} sendMessage=${this.sendMessage} pauseVideo=${this.pauseVideo} updateRoomState=${this.updateRoomState} />
                ${state.scheduleSidebar && html`
                    <${ScheduleSidebar} state=${state}/>`}
                <div id="pagetoolbar" class="${state.fullscreen ? "toolbarFullscreen" : ""}">
                    <${Controls} state=${state} state=${state} sendMessage=${this.sendMessage} updateRoomState=${this.updateRoomState} startVideo=${this.webrtc_start.bind(this)} stopVideo=${this.webrtc_stop.bind(this)}/>
                    ${!state.userlistHidden && !state.fullscreen && !state.userlistOnLeft && html`<${Userlist} showUsernames=${state.showUsernames} userlist=${state.userlist} isLeft=${false} updateRoomState=${this.updateRoomState}/>`}
                </div>
            </div>
                
            ${(state.roomSidebar != SidebarState.NOTHING) && html`<${RoomSidebar} state=${state} sendMessage=${this.sendMessage} updateRoomState=${this.updateRoomState}/>`}
            <${ProfileModal} state=${state} sendMessage=${this.sendMessage} updateRoomState=${this.updateRoomState}/>`}
            ${state.hoverText && html`<${UserHoverName} state=${state}/>`}
        </div>
    `;
    }
}
