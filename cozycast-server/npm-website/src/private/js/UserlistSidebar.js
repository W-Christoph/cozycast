import { Component, h } from 'preact'

export class UserlistSidebar extends Component {
    constructor() {
        super();
    }

    shouldComponentUpdate(nextProps, nextState){
        return this.props.state.userlist !== nextProps.state.userlist || 
            this.props.state.showUsernames !== nextProps.state.showUsernames ||
            this.props.state.isLeft !== nextProps.state.isLeft;
    }

    render({state}) {
        return <div class="userlistSidebar">
        {state.userlist.map(user =>
            <div class="userSidebar">
                 <div class="avatarContainer">
                    <div class="image avatar" style={{'background-image': `url(${user.url})`}}/>
                    <div class={`onlineDot ${user.active? "isOnline": "isInactive"}`}></div>
                    <div class={`mutedDot ${user.muted? "": "noDisplay"}`}>
                        <img class="mutedDotIcon" src="/svg/headphone-slash.svg"></img>
                    </div>
                </div>
                <div class="usernameSidebar">
                    <div class="usernameList">{user.username}</div>
                    {!user.active && 
                        <div class="lastSeen">last seen: <span>{user.lastTimeSeen}</span></div>
                        }
                </div>
            </div>
        )}
    </div>
    }
}