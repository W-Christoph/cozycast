import { Component } from '/js/libs/preact.js'
import { html } from '/js/libs/htm/preact/index.js'

export class ImageModal extends Component {

    closeModal = () => {
        this.props.setChatState({imageModal: false})
    }

    shouldComponentUpdate(nextProps, nextState){
        return false;
    }

    render({type,href}) {
        return html`
            <div class="modal-background" onclick=${this.closeModal}>
                <div class="imageModal">
                    ${type == "image" &&
                        html`<div>
                            <a class="chat-link" target="_blank" href="${href}"><img src="${href}" /></a>
                        </div>
                    `}
                    ${type == "video" &&
                        html`<div>
                            <a class="chat-link" target="_blank" href="${href}"> <video loop autoplay controls src="${href}" /></a>
                        </div>
                    `}
                </div>
            </div>`
    }
}
