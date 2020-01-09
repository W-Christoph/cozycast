import { Component, render } from '/js/libs/preact.js'
import { html } from '/js/libs/htm/preact/index.js'
import Router from '/js/libs/preact-router/index.js'

import { RoomList } from '/js/RoomList.js'
import { Room } from '/js/Room.js'

var globalVar = {};
export var state = {
    typingUsers: [],
    userlist: [],
    roomlist: [],
    chatMessages: [],
    newMessage: false,
    forceChatScroll: false,
    chatBox: "",
    remote: false,
    username: "Anonymous",
    volume: 100,
    videoPaused: true,
    videoLoading: false,
    videoSettings: null,
    session: null,
    muteChatNotification: false,
    windowTitle: "CozyCast: Low latency screen capture via WebRTC",
    historyMode: false,
    fullscreen: false
};

export function updateState(fun) {
    fun(state)
    globalVar.callback(state);
}

class App extends Component {
    render({ page }, { xyz = [] }) {
    globalVar.callback = (data) => {
        this.setState(data);
    };
    return html`
        <${Router}>
    		<${Room} state=${state} path="/" roomId="default"/>
            <${Room} state=${state} path="/room/:roomId"/>
            <${RoomList} state=${state} path="/management/"/>
        <//>
    `;
    }
}

var preactBody = render(html`<${App}/>`, document.body);
