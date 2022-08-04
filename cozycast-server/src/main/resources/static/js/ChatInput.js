import { Component, createRef } from '/js/libs/preact.js'
import { html } from '/js/libs/htm/preact/index.js'
import { state, updateState } from '/js/index.js'
import { sendMessage } from '/js/Room.js'
import { ConfirmUpload, openConfirmWindow, openConfirmWindowPaste } from '/js/ConfirmUpload.js'

var lastTypingEvent = Date.now();
var chatBox = '';
var globalTypingUsers = [];
var chatInputState = {};


export function typing(parsedMessage) {
    if(parsedMessage.state == "start") {
        var typingUser = globalTypingUsers.find(e => e.session == parsedMessage.session)
        if(typingUser) {
            typingUser.lastTypingTime = moment()
        } else {
            globalTypingUsers.push({
                username: parsedMessage.username,
                session: parsedMessage.session,
                lastTypingTime: moment()
            })
        }
    } else if(parsedMessage.state == "stop") {
        globalTypingUsers = globalTypingUsers.filter(function(user) {
            return user.session != parsedMessage.session;
        });
    }
    chatInputState.setState(globalTypingUsers);
}

export function filterTyping(session){
    globalTypingUsers = globalTypingUsers.filter(function(user) {
        return user.session != session;
    });
    chatInputState.setState(globalTypingUsers);
}

export function clearTyping(){
    chatInputState.setState(globalTypingUsers);
}


export class ChatInput extends Component {
    state = {};

    constructor() {
        chatInputState.setState = (data) => {
            this.setState({typingUsers: data});
        };
        super();
        this.typingInterval = null;
        this.state = { 
            isTyping: false,
            typingUsers: []};
    }

    componentDidMount() {
         this.typingInterval = setInterval(() => {
                 var newTypingUsers = globalTypingUsers.filter(function(user) {
                    return user.lastTypingTime.isAfter(moment().subtract(3, 'seconds'));
                 });
                 if(newTypingUsers.length != globalTypingUsers.length) {
                    globalTypingUsers = newTypingUsers
                    this.setState({typingUsers: globalTypingUsers});
                 }
         }, 1000);
    }

    componentWillUnmount() {
        if(this.typingInterval) {
            clearInterval(this.typingInterval)
        }
    }

    chatInput = (e) => {
        this.autosize();
        var enterKeycode = 13;
        chatBox = e.target.value;
        if(!this.state.isTyping && chatBox.length != 0) this.setState({isTyping: true})
        else if(this.state.isTyping && chatBox.length == 0) this.setState({isTyping: false})
        var now = Date.now();
        if(now - lastTypingEvent > 1000) {
            sendMessage({
                action : 'typing',
                state: 'start'
            });
            lastTypingEvent = now;
        }
    }

    chatEnter = (e) => {
        var enterKeycode = 13;
        if(e.which == enterKeycode) {
            e.preventDefault();
            if(e.shiftKey) {
                chatBox += "\n"
                e.target.value = chatBox; // hack
                this.autosize();
            } else {
                if(chatBox.trim() != "") {
                    sendMessage({
                        action : 'chatmessage',
                        type: "text",
                        message: chatBox
                    });
                }
                chatBox = "";
                e.target.value = chatBox; // hack

                sendMessage({
                    action : 'typing',
                    state: 'stop'
                });
                this.autosize();
                this.setState({isTyping: false});
            }
        }
    }
    
    refTaWrapper = createRef();
    refChatboxText = createRef();
    autosize = () => {
        var div = this.refTaWrapper.current;
        var ta =  this.refChatboxText.current;
        var messages = document.getElementById("messages");
    
     setTimeout(function() {
         ta. style.cssText = 'height:0px';
         var height = Math.min(18*5, ta.scrollHeight);
         div.style.cssText = 'height:' + (20 + height) + 'px';
         ta. style.cssText = 'height:' + height + 'px';
         if(!state.historyMode) messages.scrollTop = messages.scrollHeight;
        },0);
    }
    
    refImageUploadFile = createRef();
    openPictureUpload =() => {
        this.refImageUploadFile.current.click();
    }

    render({state}) {
        return html`
            <${ConfirmUpload} state=${state}/>
            <div id="chatbox" onclick=${() => this.refChatboxText.current.focus()}>
                <div class="image-uploader">
                    <div class="ta-wrapper" ref=${this.refTaWrapper}>
                    <textarea id="chat-textbox" ref=${this.refChatboxText} class="chatbox-textarea" oninput=${this.chatInput} onkeypress=${this.chatEnter} onpaste=${(e)=>{this.autosize();openConfirmWindowPaste(e)}}>
                        ${chatBox}
                    </textarea>
                    </div>
                    <div class="image-uploader-button-wrapper">
                        <input id="image-upload-file" type="file" name="image" accept="image/png, image/jpeg, image/gif, video/webm,  image/webp" onchange=${openConfirmWindow} ref=${this.refImageUploadFile}/>
                        ${!this.state.isTyping &&
                            html`<img class="image-uploader-button" src="/svg/image_upload.svg" onclick=${this.openPictureUpload}/>`}
                    </div>
                </div>
                <div id="typing">
                    ${this.state.typingUsers.length > 0 && html`
                        ${this.state.typingUsers.length > 2 ? "Several people" : this.state.typingUsers.map((user, i) => html`${user.username}${(this.state.typingUsers.length - 1 != i) && ', '}`)} ${this.state.typingUsers.length > 1 ? 'are ' : 'is '}
                        <div class="typingWrapper">typing<div class="loadingDotsWrapper"><div class="loadingDots"></div></div></div>
                    `}
                </div>
            </div>
            `
    }

    
}
