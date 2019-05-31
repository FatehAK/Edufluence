io = io.connect();

var myName = '';
var theirName = '';
var myUserType = '';
var configuration = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};
var rtcPeerConn;
var mainVideoArea = document.querySelector('#mainVideoTag');
var smallVideoArea = document.querySelector('#smallVideoTag');
// var dataChannelOptions = {
//     ordered: false,
//     maxPacketLifeTime: 1000,
// };
var dataChannel;

io.on('signal', async function(data) {
    if (data.user_type === 'expert' && data.command === 'joinroom') {
        if (myUserType === 'student') {
            theirName = data.user_name;
            document.querySelector('#messageOutName').textContent = theirName;
            document.querySelector('#messageInName').textContent = myName;
        }
        document.querySelector('#requestExpertForm').style.display = 'none';
        document.querySelector('#waitingForExpert').style.display = 'none';
        document.querySelector('#expertListing').style.display = 'block';
    }
    else if (data.user_type === 'student' && data.command === 'callexpert') {
        if (!rtcPeerConn) {
            startSignaling();
        }
        if (myUserType === 'expert') {
            theirName = data.user_name;
            document.querySelector('#messageOutName').textContent = theirName;
            document.querySelector('#messageInName').textContent = myName;
        }
        document.querySelector('#expertSignup').style.display = 'none';
        document.querySelector('#videoPage').style.display = 'block';
    }
    else if (data.user_type == 'signaling') {
        // if (!rtcPeerConn) {
        //     console.log('peer in 2');
        //     startSignaling();
        // }
        var message = JSON.parse(data.user_data);
        try {
            if (message.sdp) {
                if (message.sdp.type === 'offer' && myUserType === 'expert') {
                    console.log('offering');
                    await rtcPeerConn.setRemoteDescription(new RTCSessionDescription(message.sdp)).catch((err) => console.log(err));
                    await rtcPeerConn.setLocalDescription(await rtcPeerConn.createAnswer());
                    io.emit('signal', {
                        user_type: 'signaling',
                        command: 'SDP',
                        user_data: JSON.stringify({ sdp: rtcPeerConn.localDescription })
                    });
                } else if (message.sdp.type === 'answer' && myUserType === 'student') {
                    console.log('answering');
                    await rtcPeerConn.setRemoteDescription(new RTCSessionDescription(message.sdp)).catch((err) => console.log(err));
                } else {
                    console.log('Unsupported SDP type.');
                }
            } else if (message.candidate) {
                await setTimeout(() => rtcPeerConn.addIceCandidate(new RTCIceCandidate(message.candidate)).catch((err) => console.log(err)), 5000);
            }
        } catch (err) {
            console.log('SDP error :' + err);
        }
    }
});

//on negotiation called
function startSignaling() {
    console.log('starting signaling...');
    if (RTCPeerConnection) {
        //firefox
        rtcPeerConn = new RTCPeerConnection(configuration);
    } else {
        if (webkitRTCPeerConnection) {
            //chrome
            rtcPeerConn = new webkitRTCPeerConnection(configuration);
        }
    }
    // dataChannel = rtcPeerConn.createDataChannel('textMessages', dataChannelOptions);
    dataChannel = rtcPeerConn.createDataChannel('mychannel');
    dataChannel.binaryType = 'arraybuffer';
    console.log(dataChannel);

    dataChannel.onerror = (error) => {
        console.log("Data Channel Error:", error);
    };
    dataChannel.onopen = function() {
        if (dataChannel.readyState === 'open') {
            console.log('Data Channel open');
            dataChannel.onmessage = receiveDataChannelMessage;
        }
    };
    rtcPeerConn.ondatachannel = function(evt) {
        console.log('Receiving a data channel');
        dataChannel = evt.channel;
        dataChannel.onmessage = receiveDataChannelMessage;
    };
    rtcPeerConn.onicecandidate = function(evt) {
        called = true;
        if (evt.candidate)
            io.emit('signal', {
                user_type: 'signaling',
                command: 'icecandidate',
                user_data: JSON.stringify({ candidate: evt.candidate })
            });
    };

    let negotiating;
    rtcPeerConn.onnegotiationneeded = async function() {
        console.log('on negotiation called');
        if (myUserType === 'student') {
            try {
                if (negotiating || rtcPeerConn.signalingState != "stable") return;
                negotiating = true;
                await rtcPeerConn.setLocalDescription(await rtcPeerConn.createOffer());
                io.emit('signal', {
                    user_type: 'signaling',
                    command: 'SDP',
                    user_data: JSON.stringify({ sdp: rtcPeerConn.localDescription })
                });
            } catch (err) {
                console.error(err);
            } finally {
                negotiating = false;
            }
        }
    };

    rtcPeerConn.ontrack = function(evt) {
        mainVideoArea.srcObject = evt.streams[0];
    };

    let constraints = {
        audio: true,
        video: true
    };
    navigator.mediaDevices.getUserMedia(constraints)
        .then(function(stream) {
            smallVideoArea.srcObject = stream;
            stream.getTracks().forEach(function(track) {
                rtcPeerConn.addTrack(track, stream);
            });
        })
        .catch(function(err) {
            console.log(err);
        });
}

/* messaging and file transfer */
var messageHolder = document.querySelector('#messageHolder');
var myMessage = document.querySelector('#myMessage');
var sendMessage = document.querySelector('#sendMessage');
var receivedFileName;
var receivedFileSize;
var fileBuffer = [];
var fileSize = 0;
var fileTransferring = false;

function receiveDataChannelMessage(evt) {
    // console.log('From DataChannel: ' + evt.data);
    try {
        if (fileTransferring) {
            fileBuffer.push(evt.data);
            fileSize += evt.data.byteLength;
            fileProgress.value = fileSize;
            console.log('fileSize: ' + fileSize);
            console.log('receivedFileSize: ' + receivedFileSize);
            if (fileSize === receivedFileSize) {
                var received = new window.Blob(fileBuffer);
                fileBuffer = [];
                downloadLink.href = URL.createObjectURL(received);
                downloadLink.download = receivedFileName;
                downloadLink.appendChild(document.createTextNode(receivedFileName + '(' + fileSize + ') bytes'));
                fileTransferring = false;
                var linkTag = document.createElement('a');
                console.log(received);
                linkTag.href = URL.createObjectURL(received);
                linkTag.download = receivedFileName;
                linkTag.appendChild(document.createTextNode(receivedFileName));
                var div = document.createElement('div');
                div.className = 'message-out';
                div.appendChild(linkTag);
                messageHolder.appendChild(div);
            }
        }
        else {
            console.log('messaging');
            appendChatMessage(evt.data, 'message-out');
        }
    } catch (err) {
        console.log(err);
    }
}

sendMessage.addEventListener('click', function(evt) {
    dataChannel.send(myMessage.value);
    appendChatMessage(myMessage.value, 'message-in');
    myMessage.value = '';
    evt.preventDefault();
});

function appendChatMessage(msg, className) {
    var div = document.createElement('div');
    div.className = className;
    div.innerHTML = '<span>' + msg + '</span>';
    messageHolder.appendChild(div);
}

/* file transfer */
var sendFile = document.querySelector('#sendFile');
var fileProgress = document.querySelector('#fileProgress');
var downloadLink = document.querySelector('#receivedFileLink');

io.on('files', function(data) {
    receivedFileName = data.filename;
    receivedFileSize = data.filesize;
    console.log('File on the way is ' + receivedFileName + ' (' + receivedFileSize + ')');
    fileTransferring = true;
});

sendFile.addEventListener('change', function() {
    try {
        var file = sendFile.files[0];
        console.log('sending file ' + file.name + ' (' + file.size + ') ...');
        io.emit('files', {
            filename: file.name,
            filesize: file.size
        });

        appendChatMessage("sending " + file.name, 'message-in');
        fileTransferring = true;
        fileProgress.max = file.size;
        var chunkSize = 16384;
        let res = 0;
        var sliceFile = function(offset) {
            var reader = new window.FileReader();
            reader.onload = (function() {
                return function(e) {
                    res += e.target.result.byteLength;
                    console.log('res: ' + res);
                    dataChannel.send(e.target.result);
                    if (file.size > offset + e.target.result.byteLength) {
                        window.setTimeout(sliceFile, 0, offset + chunkSize);
                    }
                    fileProgress.value = offset + e.target.result.byteLength;
                };
            })(file);
            var slice = file.slice(offset, offset + chunkSize);
            console.log(slice);
            reader.readAsArrayBuffer(slice);
        };
        sliceFile(0);
        fileTransferring = false;
    } catch (err) {
        console.log(err);
    }
});

/* muting and pausing video */
var muteMyself = document.querySelector('#muteMyself');
var pauseMyVideo = document.querySelector('#pauseMyVideo');

muteMyself.addEventListener('click', function(evt) {
    console.log('muting/unmuting myself');
    var streams = rtcPeerConn.getLocalStreams();
    for (var stream of streams) {
        for (var audioTrack of stream.getAudioTracks()) {
            if (audioTrack.enabled) {
                muteMyself.innerHTML = 'Unmute'
            } else {
                muteMyself.innerHTML = 'Mute Myself'
            }
            audioTrack.enabled = !audioTrack.enabled;
        }
        console.log('Local stream: ' + stream.id);
    }
    evt.preventDefault();
});

pauseMyVideo.addEventListener('click', function(evt) {
    console.log('pausing/unpausing my video');
    var streams = rtcPeerConn.getLocalStreams();
    for (var stream of streams) {
        for (var videoTrack of stream.getVideoTracks()) {
            if (videoTrack.enabled) {
                pauseMyVideo.innerHTML = 'Start Video'
            } else {
                pauseMyVideo.innerHTML = 'Pause Video'
            }
            videoTrack.enabled = !videoTrack.enabled;
        }
        console.log('Local stream: ' + stream.id);
    }
    evt.preventDefault();
});

/* screen sharing */
var shareMyScreen = document.querySelector('#shareMyScreen');
shareMyScreen.addEventListener('click', function(evt) {
    shareScreenText = 'Share Screen';
    stopShareScreenText = 'Stop Sharing';
    console.log('Screen share button text: ' + shareMyScreen.innerHTML);

    if (shareMyScreen.innerHTML == shareScreenText) {
        var msg = 'Sharing my screen...';
        appendChatMessage(msg, 'message-in');
        getScreenMedia(function(err, stream) {
            if (err) {
                console.log('failed: ' + err);
            } else {
                console.log('got a stream', stream);
                smallVideoArea.srcObject = stream;
                stream.getTracks().forEach(function(track) {
                    rtcPeerConn.addTrack(track, stream);
                });
            }
        });
        shareMyScreen.innerHTML = stopShareScreenText;
    } else {
        console.log('Resetting my stream to video...');
        let constraints = {
            audio: true,
            video: true
        };
        navigator.mediaDevices.getUserMedia(constraints)
            .then(function(stream) {
                smallVideoArea.srcObject = stream;
                stream.getTracks().forEach(function(track) {
                    rtcPeerConn.addTrack(track, stream);
                });
            })
            .catch(function(err) {
                console.log(err);
            });

        shareMyScreen.innerHTML = shareScreenText;
    }
    evt.preventDefault();
});
