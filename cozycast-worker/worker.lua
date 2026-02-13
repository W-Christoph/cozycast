local websocket = require "http.websocket"
local lunajson = require 'lunajson'
local ffi = require("ffi")
local libxdo = ffi.load("libxdo.so.3")

ffi.cdef[[
typedef unsigned int useconds_t;
typedef unsigned long XID;
typedef XID KeySym;
typedef unsigned char KeyCode;
typedef XID Window;
typedef struct Display {
} Display;
typedef struct charcodemap {
  wchar_t key;
  KeyCode code;
  KeySym symbol;
  int group;
  int modmask;
  int needs_binding;
} charcodemap_t;
typedef struct xdo {
    Display *xdpy;
    char *display_name;
    charcodemap_t *charcodes;
    int charcodes_len;
    int keycode_high;
    int keycode_low;
    int keysyms_per_keycode;
    int close_display_when_freed;
    int quiet;
    int debug;
    int features_mask;
} xdo_t;
xdo_t* xdo_new(const char *display);
int xdo_move_mouse(const xdo_t *xdo, int x, int y, int screen);
int xdo_click_window(const xdo_t *xdo, Window window, int button);
int xdo_mouse_down(const xdo_t *xdo, Window window, int button);
int xdo_mouse_up(const xdo_t *xdo, Window window, int button);
int xdo_enter_text_window(const xdo_t *xdo, Window window, const char *string, useconds_t delay);
int xdo_send_keysequence_window(const xdo_t *xdo, Window window,
                    const char *keysequence, useconds_t delay);
int xdo_send_keysequence_window_up(const xdo_t *xdo, Window window,
                       const char *keysequence, useconds_t delay);
int xdo_send_keysequence_window_down(const xdo_t *xdo, Window window,
                        const char *keysequence, useconds_t delay);
void xdo_free(xdo_t *xdo);
]]

local mouse_web_to_xdo = {
    [0] = 1,
    [1] = 2,
    [2] = 3,
}

local keyboard_web_to_xdo = {
    [" "] = "space",
    ["€"] = "EuroSign",
    ["°"] = "degree",
    ["µ"] = "mu",
    ["ß"] = "ssharp",
    ["-"] = "minus",
    ["+"] = "plus",
    ["."] = "period",
    [":"] = "colon",
    ["|"] = "bar",
    ["/"] = "slash",
    ["\\"] = "backslash",
    [";"] = "semicolon",
    ["$"] = "dollar",
    ["#"] = "numbersign",
    ["!"] = "exclam",
    ["%"] = "percent",
    ["&"] = "ampersand",
    ["\""] = "quotedbl",
    ["'"] = "apostrophe",
    ["("] = "parenleft",
    [")"] = "parenright",
    ["*"] = "asterisk",
    [","] = "comma",
    ["<"] = "less",
    ["="] = "equal",
    [">"] = "greater",
    ["?"] = "question",
    ["@"] = "at",
    ["["] = "bracketleft",
    ["]"] = "bracketright",
    ["^"] = "dead_circumflex",
    ["_"] = "underscore",
    ["`"] = "dead_grave",
    ["´"] = "dead_acute",
    ["{"] = "braceleft",
    ["}"] = "braceright",
    ["~"] = "asciitilde",
    ["PageUp"] = "Prior",
    ["PageDown"] = "Next",
    ["Enter"] = "KP_Enter",
    ["Escape"] = "Escape",
    ["ArrowLeft"] = "Left",
    ["ArrowRight"] = "Right",
    ["ArrowUp"] = "Up",
    ["ArrowDown"] = "Down",
    ["Backspace"] = "BackSpace",
}

local debugCozy = false

local pressed_keys = {}

function wait_for_pulseaudio()
    while true do
        print("worker.lua: wait_for_pulseaudio ")
        local pgrep = io.popen('pgrep "pulseaudio" -c', 'r')
        local stdout = pgrep:read("*a")
        local count = tonumber(stdout)
        if count ~= 0 then
            return true
        end
        pgrep:close()
        os.execute("sleep 1")
    end
end

local video_settings = {
    desktop_width = 1280,
    desktop_height =  720,
    scale_width = 1280,
    scale_height =  720,
    frame_rate = 25,
    video_bitrate = "1M",
    audio_bitrate = "192k"
}

-- Add this helper function to debug PulseAudio state
function dump_pulse_info()
    print("--- PULSEAUDIO DIAGNOSTICS ---")
    local cmd_prefix = "sudo -u cozycast pactl --server unix:/tmp/pulse-socket "
    
    print("[1] Server Info:")
    os.execute(cmd_prefix .. "info")
    
    print("[2] Sinks (Outputs):")
    os.execute(cmd_prefix .. "list sinks short")
    
    print("[3] Sources (Inputs):")
    os.execute(cmd_prefix .. "list sources short")
    
    print("[4] Default Sink:")
    os.execute(cmd_prefix .. "get-default-sink")
    
    print("[5] Default Source:")
    os.execute(cmd_prefix .. "get-default-source")
    print("------------------------------")
end

function capture(whipUrl, streamKey, ws)
    wait_for_pulseaudio()
    
    print("woker video settings.")
    for key, value in pairs(video_settings) do
        print(key .. ": " .. tostring(value))
    end

    -- Helper to parse "1M" -> 1000 or "500k" -> 500
    local function parse_bitrate_kbps(str)
        local num = tonumber(str:match("[%d%.]+"))
        if str:find("M") then return math.floor(num * 1000) end
        if str:find("k") then return math.floor(num) end
        return math.floor(num)
    end
    
    local function parse_bitrate_bps(str)
         -- Opusenc expects bits per second usually, but we can pass standard int
         -- 192k -> 192000
         local num = tonumber(str:match("[%d%.]+"))
         if str:find("M") then return math.floor(num * 1000000) end
         if str:find("k") then return math.floor(num * 1000) end
         return math.floor(num)
    end

    local video_bitrate_kbps = parse_bitrate_kbps(video_settings.video_bitrate)
    local audio_bitrate_bps = parse_bitrate_bps(video_settings.audio_bitrate)

    print("worker.lua: Dumping PulseAudio state before capture...")
    dump_pulse_info()

    local width = video_settings.scale_width
    local height = video_settings.scale_height
    local fps = video_settings.frame_rate

    -- ultrafast, veryfast, medium, 
    local speed_preset = "veryfast"

    -- GStreamer Pipeline Construction
    -- Video: ximagesrc -> convert -> x264enc -> whipsink
    -- Audio: pulsesrc -> convert -> opusenc -> whipsink
    
    local pipeline_parts = {
        "whipclientsink name=ws signaller::whip-endpoint=\"" .. whipUrl .. "\" signaller::auth-token=\"" .. streamKey .. "\"",
        
        -- Video Branch with a queue
        "ximagesrc display-name=:0 use-damage=1",
        "! queue ! video/x-raw,framerate=" .. fps .. "/1",
        "! videoscale ! video/x-raw,width=" .. width .. ",height=" .. height,
        "! videoconvert",
        -- Add qp-min=24 to prevent bit-stuffing on still images
        "! x264enc tune=zerolatency speed-preset=".. speed_preset .. " bitrate=" .. video_bitrate_kbps .. " qp-min=24 key-int-max=" .. (fps * 2),
        --"! vp8enc target-bitrate=" .. (video_bitrate_kbps * 1000) .. " deadline=0 cpu-used=4 keyframe-max-dist=" .. (fps * 2),
        "! ws.video_0",

        -- Audio Branch with a queue
        "pulsesrc device=CozySink.monitor server=unix:/tmp/pulse-socket",
        "! queue ! audioconvert",
        "! opusenc bitrate=" .. audio_bitrate_bps,
        "! ws.audio_0"
    }

    local options_string = table.concat(pipeline_parts, " ")

    if debugCozy then
        print ("worker.lua: /capture.sh " .. options_string)
    end

    print("worker.lua: starting capture to WHIP Target")
    os.execute ("/capture.sh " .. options_string)
end

local last_keepalive = 0

function keepalive(ws)
    ws:send(lunajson.encode{
        action = "keepalive"
    })
end

local worker = {}

local lastWindowTitle
function worker.update_active_window_title(ws)
    local windowName = io.popen('xdotool getactivewindow getwindowname 2>/dev/null');
    local stdout = windowName:read("*a")
    windowName:close()
    if lastWindowTitle ~= stdout then
        ws:send(lunajson.encode{
            action = "window_title",
            title = stdout
        })
        lastWindowTitle = stdout;
    end
end

function worker.mouse_move(mouseX, mouseY)
    mouseX = math.floor(mouseX)
    mouseY = math.floor(mouseY)
    if mouseX and mouseY
        and mouseX ~= 0
        and mouseY ~= 0
        and mouseX >= 0
        and mouseY >= 0 then
            libxdo.xdo_move_mouse(xdo, mouseX, mouseY, 0)
    end
end

function worker.mouse_up(mouseX, mouseY, button)
    worker.mouse_move(mouseX, mouseY)
    local xdo_button = (mouse_web_to_xdo[button])
    if xdo_button then
        libxdo.xdo_mouse_up(xdo, 0, xdo_button)
    end
end

function worker.mouse_down(mouseX, mouseY, button)
    worker.mouse_move(mouseX, mouseY)
    local xdo_button = (mouse_web_to_xdo[button])
    if xdo_button then
        libxdo.xdo_mouse_down(xdo, 0, xdo_button)
    end
end

function worker.textinput(text)
    libxdo.xdo_enter_text_window(xdo, 0, text, 0);
end

function worker.clipboard_write(text)
    local xclip = io.popen("xclip -selection clipboard", 'w')
    xclip:write(text or "")
    xclip:close()
    libxdo.xdo_send_keysequence_window(xdo, 0, "ctrl+v", 0);
end

function worker.key_up(key)
    key = keyboard_web_to_xdo[key] or key
    pressed_keys[key] = nil
    if key then
        libxdo.xdo_send_keysequence_window_up(xdo, 0, key, 0);
    end
end

function worker.key_down(key)
    key = keyboard_web_to_xdo[key] or key
    pressed_keys[key] = true
    if key then
        libxdo.xdo_send_keysequence_window_down(xdo, 0, key, 0);
    end
end

function worker.keyboard_reset(key)
    for key, pressed in pairs(pressed_keys) do
        if key then
            libxdo.xdo_send_keysequence_window_up(xdo, 0, key, 0);
            pressed_keys[key] = nil
        end
    end
end

function worker.scroll_up()
    libxdo.xdo_click_window(xdo, 0, 4);
end

function worker.scroll_down()
    libxdo.xdo_click_window(xdo, 0, 5);
end

local active_vm_flag = false

function start_vm() 
    print("worker.lua: starting vm and audio")

    -- Start Xvfb
    os.execute ("Xvfb :0 -screen 0 "..video_settings.desktop_width.."x"..video_settings.desktop_height.."x24 -nolisten tcp & echo $! >> /worker.pid")
    
    -- Start PulseAudio with a fixed, anonymous socket
    os.execute ("sudo -u cozycast pulseaudio --kill 2>/dev/null")
    os.execute ("sudo -u cozycast pulseaudio --daemonize=no --exit-idle-time=-1 --load='module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulse-socket' & echo $! >> /worker.pid")
    
    -- Start Desktop
    os.execute ("sudo -u cozycast xfce4-session & echo $! >> /worker.pid")
    
    -- Give things time to initialize
    os.execute("sleep 5")
    
    -- Configure PulseAudio with a virtual sink
    print("worker.lua: configuring virtual audio sink")
    local pulse_cmd = "sudo -u cozycast pactl --server unix:/tmp/pulse-socket "
    os.execute(pulse_cmd .. "load-module module-null-sink sink_name=CozySink")
    os.execute(pulse_cmd .. "set-default-sink CozySink")
    os.execute(pulse_cmd .. "set-default-source CozySink.monitor")

    -- Allow cozycast user to access the X display
    os.execute("xhost +SI:localuser:cozycast")

    xdo = libxdo.xdo_new(nil)
    print("worker.lua: VM Started Successfully")
end

local lastCallTimestamp = 0
function onmessage(ws, data)
    if data.action == "keepalive" then
        -- skip keepalive response
        return true
    end
    -- 1. Handle WHIP offer from server
    if data.type == "whipOffer" then
        print("worker.lua: Received Ingress Offer (WHIP)")
        if not active_vm_flag then 
            start_vm()
            active_vm_flag = true
        end
        print(data)
        
        -- Call capture with separated URL and Key
        capture(data.url, data.key, ws)
        return true
    end
    
    local currentTime = os.time()
    if currentTime - lastCallTimestamp >= 1 then
        lastCallTimestamp = currentTime
        worker.update_active_window_title(ws)
    end
    if data.action == "mousemove" then
        worker.mouse_move(data.mouseX, data.mouseY)
        return true
    end
    if data.action == "mouseup" then
        worker.mouse_up(data.mouseX, data.mouseY, data.button)
        return true
    end
    if data.action == "mousedown" then
        worker.mouse_down(data.mouseX, data.mouseY, data.button)
        return true
    end

    if data.action == "textinput" then
        worker.textinput(data.text)
        return true
    end

    if data.action == "paste" then
        worker.clipboard_write(data.clipboard)
        return true
    end
    if data.action == "keyup" then
        worker.key_up(data.key)
        return true
    end
    if data.action == "keydown" then
        worker.key_down(data.key)
        return true
    end
    if data.action == "reset_keyboard" then
        worker.keyboard_reset()
        return true
    end
    if data.action == "scroll" then
        if data.direction == "up" then
            worker.scroll_up()
        end
        if data.direction == "down" then
            worker.scroll_down()
        end
        return true
    end
    if data.action == "worker_restart" then
        print "worker.lua: Worker restart requested..."
        os.execute("echo '' >> /worker.restart")
        return true
    end
    if data.action == "worker_update_settings" then
        print "worker.lua: Updating video settings"

        local new_desktop_dimension = false

        if active_vm_flag and (video_settings.desktop_width ~= data.settings.desktopWidth or video_settings.desktop_height ~= data.settings.desktopHeight) then
            new_desktop_dimension = true
        end

        video_settings.scale_width = data.settings.scaleWidth
        video_settings.scale_height = data.settings.scaleHeight
        video_settings.desktop_width = data.settings.desktopWidth
        video_settings.desktop_height = data.settings.desktopHeight
        video_settings.frame_rate = data.settings.framerate
        video_settings.video_bitrate = data.settings.videoBitrate
        video_settings.audio_bitrate = data.settings.audioBitrate

        if data.restart then
            print "worker.lua: Worker restart with settings update requested..."
            os.execute("echo '' >> /worker.restart")
        end
        return true
    end
    return false
end

function start_server()
    print("worker.lua: Starting Worker")

    local server = os.getenv("COZYCAST_IP")
    if os.getenv("HTTPS_DOMAIN") ~= "" then
        server = os.getenv("HTTPS_DOMAIN")
    end

    if os.getenv("LOCAL_WORKER") == "true" then
        print("Worker.lua: Using local worker")
        server="cozycast-server"
    end

    print("worker.lua: env "..os.getenv("COZYCAST_ROOM"))
    local room = os.getenv("COZYCAST_ROOM") or "default"
    local room_key = os.getenv("COZYCAST_WORKER_KEY") or "no_key"
    local url = "ws://"..server.."/worker/"..room.."/"
    if os.getenv("FORCE_HTTPS") == "true" then
        url = "wss://"..server.."/worker/"..room.."/"
    end
    print("worker.lua: Connecting to "..url.. " Room: "..room)
    local ws = websocket.new_from_uri(url..room_key)
    ws:connect(2)

    io.stdout:flush()

    while true do
        local msg, error, errno = ws:receive(5)
        if errno == 107 or errno == 32 or (not msg and not error and not errno) then
            print("worker.lua: Could not connect to "..url)
            return
        end
        if errno == 110 then -- timeout
            keepalive(ws)
            worker.update_active_window_title(ws)
        else
            status, error = pcall(function()
                if error == "text" then
                    local data = lunajson.decode(msg)
                    if not onmessage(ws, data) then
                        print("worker.lua: Unknown message: "..msg)
                        print(error)
                        print(errno)
                    end
                end
            end)
            if not status then
                print(error)
            end
        end
        if last_keepalive < os.time() - 10 then
            keepalive(ws)
            last_keepalive = os.time()
        end
        io.stdout:flush()
    end

    ws:close()
end

while true do
    -- Run the server and catch any errors
    local status, err = pcall(start_server)
    if not status then
        print("worker.lua: Runtime error: " .. tostring(err))
    end
    
    -- Just wait 5 seconds and try to reconnect to the websocket.
    print("worker.lua: Connection lost or timed out. Reconnecting in 5 seconds...")
    os.execute("sleep 5")
end
libxdo.xdo_free(xdo)
