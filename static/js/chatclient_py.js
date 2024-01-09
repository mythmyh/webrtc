// WebSocket and WebRTC based multi-user chat sample with two-way video
// calling, including use of TURN if applicable or necessary.
//
// This file contains the JavaScript code that implements the client-side
// features for connecting and managing chat and video calls.
//
// To read about how this sample works:  http://bit.ly/webrtc-from-chat
//
// Any copyright is dedicated to the Public Domain.
// http://creativecommons.org/publicdomain/zero/1.0/

"use strict";

var initiative_invite=true;
var video_index=0;
var userList=new Set();
// Get our hostname
var senders=new Set();
var client_list = {}
var medial_list={}
var myHostname = window.location.hostname;
if (!myHostname) {
  myHostname = "localhost";
}
var sender=null
console.log("Hostname: " + myHostname);

// WebSocket chat/signaling channel variables.

var connection = null;
var clientID = 0;

// The media constraints object describes what sort of stream we want
// to request from the local A/V hardware (typically a webcam and
// microphone). Here, we specify only that we want both audio and
// video; however, you can be more specific. It's possible to state
// that you would prefer (or require) specific resolutions of video,
// whether to prefer the user-facing or rear-facing camera (if available),
// and so on.
//
// See also:
// https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamConstraints
// https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
//

var mediaConstraints = {
  audio: true,            // We want an audio track
  video: {
    aspectRatio: {
      ideal: 1.333333     // 3:2 aspect is preferred
    }
  }
};
var displayConstraints={
  audio:{sampleRate:440000,sampleSize:24,},
  video:{
    freameRate:{ideal:30,max:60},
    width:2560,height:1440,
  }
}

var myUsername = null;
var targetUsername = null;      // To store username of other peer
//var myPeerConnection = null;    // RTCPeerConnection
var transceiver = null;         // RTCRtpTransceiver
var webcamStream = null;        // MediaStream from webcam
var webcamStream2 = null;        // MediaStream from webcam
var caller=true;
var ssd = null;
var ps = 0;
// Output console.logging information to console.

function consolelog(text) {
  var time = new Date();

  console.log("[" + time.toLocaleTimeString() + "] " + text);
}

// Output an error message to console.

function log_error(text) {
  var time = new Date();

  console.trace("[" + time.toLocaleTimeString() + "] " + text);
}

// Send a JavaScript object by converting it to JSON and sending
// it as a message on the WebSocket connection.

function sendToServer(msg) {
  var msgJSON = JSON.stringify(msg);

  console.log("Sending '" + msg.type + "' message: " + msgJSON);
  connection.send(msgJSON);
}

// Called when the "id" message is received; this message is sent by the
// server to assign this console.login session a unique ID number; in response,
// this function sends a "username" message to set our username for this
// session.
function setUsername() {
  myUsername = document.getElementById("name").value;

  sendToServer({
    name: myUsername,
    date: Date.now(),
    id: clientID,
    type: "username"
  });
}

// Open and configure the connection to the WebSocket server.

function connect() {
  var serverUrl;
  var scheme = "ws";

  // If this is an HTTPS connection, we have to use a secure WebSocket
  // connection too, so add another "s" to the scheme.

  if (document.location.protocol === "https:") {
    scheme += "s";
  }
  serverUrl = scheme + "://" + myHostname + ":8000/";

  console.log(`Connecting to server: ${serverUrl}`);
  connection = new WebSocket(serverUrl);


  connection.onopen = function (evt) {
    document.getElementById("text").disabled = false;
    document.getElementById("send").disabled = false;
    console.log("==========>")
    document.getElementById("login").disabled = true;

  };

  connection.onerror = function (evt) {
    console.dir(evt);
  }

  connection.onmessage = function (evt) {
    var chatBox = document.querySelector(".chatbox");
    var text = "";
    var msg = JSON.parse(evt.data);
    console.log("Message received: ");
    if(msg.type!="new-ice-candidate"){   
     console.dir(msg);
    }
    var time = new Date(msg.date);
    var timeStr = time.toLocaleTimeString();

    switch (msg.type) {
      case "id":
        clientID = msg.id;
        setUsername();
        break;

      case "username":
        text = "<b>User <em>" + msg.name + "</em> signed in at " + timeStr + "</b><br>";
        break;

      case "message":
        text = "(" + timeStr + ") <b>" + msg.name + "</b>: " + msg.text + "<br>";
        break;

      case "rejectusername":
        myUsername = msg.name;
        text = "<b>Your username has been set to <em>" + myUsername +
          "</em> because the name you chose is in use.</b><br>";
        break;

      case "userlist":      // Received an updated user list
        handleUserlistMsg(msg);
        break;

      // Signaling messages: these messages are used to trade WebRTC
      // signaling information during negotiations leading up to a video
      // call.

      case "video-offer":  // Invitation and offer to chat
        handleVideoOfferMsg(msg);
        break;

      case "video-answer":  // Callee has answered our offer
        handleVideoAnswerMsg(msg);
        break;

      case "new-ice-candidate": // A new ICE candidate has been received
        handleNewICECandidateMsg(msg);
        break;

      case "hang-up": // The other peer has hung up the call
        handleHangUpMsg(msg);
        break;

      // Unknown message; output to console for debugging.
      case "leave":
        handleLeave(msg);
        break;

      default:
        console.log("Unknown message received:");
        console.log(msg)

    }

    // If there's text to insert into the chat buffer, do so now, then
    // scroll the chat panel so that the new text is visible.

    if (text.length) {
      chatBox.innerHTML += text;
      chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
    }
  };
}

// Handles a click on the Send button (or pressing return/enter) by
// building a "message" object and sending it to the server.
function handleSendButton() {
  var msg = {
    text: document.getElementById("text").value,
    type: "message",
    id: clientID,
    date: Date.now()
  };
  sendToServer(msg);
  document.getElementById("text").value = "";
}

// Handler for keyboard events. This is used to intercept the return and
// enter keys so that we can call send() to transmit the entered text
// to the server.
function handleKey(evt) {
  if (evt.keyCode === 13 || evt.keyCode === 14) {
    if (!document.getElementById("send").disabled) {
      handleSendButton();
    }
  }
}

// Create the RTCPeerConnection which knows how to talk to our
// selected STUN/TURN server and then uses getUserMedia() to find
// our camera and microphone and add that stream to the connection for
// use in our video call. Then we configure event handlers to get
// needed notifications on the call.
function handleLeave(msg){
  var myPeerConnection=client_list[msg.name]
  console.log(myPeerConnection)
  if(!myPeerConnection ){   
    if(myPeerConnection.iceConnectionState=="connected")
  myPeerConnection.close();
}
  client_list[msg.name]=null;
  userList.delete(msg.name)
medial_list[msg.name]=false
var element=document.getElementById(msg.name)
element.remove();

}
async function createPeerConnection(targetUsername) {
  console.log("Setting up a connection...");

  // Create an RTCPeerConnection which knows to use our chosen
  // STUN server.

  var myPeerConnection = new RTCPeerConnection({
    iceServers: [     // Information about ICE servers - Use your own!
      {
        urls: "turn:" + myHostname,  // A TURN server
        username: "webrtc",
        credential: "turnserver"
      }
    ],
    sdpSemantics:'plan-b'

  });

  // Set up event handlers for the ICE negotiation process.

  myPeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("*** Outgoing ICE candidate: " + event.candidate.candidate);
      console.log(myUsername,"==> ",targetUsername)
      sendToServer({
        name: myUsername,
        type: "new-ice-candidate",
        target: targetUsername,
        candidate: event.candidate
      });
    }
  };
  myPeerConnection.oniceconnectionstatechange = (event) => {
    console.log("*** ICE connection state changed to " + myPeerConnection.iceConnectionState);

    switch (myPeerConnection.iceConnectionState) {
      case "closed":
      case "failed":
      case "disconnected":
        closeVideoCall(myPeerConnection);
        break;
    }
  };
  myPeerConnection.onicegatheringstatechange = (event) => {
    console.log("*** ICE gathering state changed to: " + myPeerConnection.iceGatheringState);
  }
    ;
  myPeerConnection.onsignalingstatechange = (event) => {
    console.log("*** WebRTC signaling state changed to: " + myPeerConnection.signalingState);
    switch (myPeerConnection.signalingState) {
      case "closed":
        closeVideoCall(myPeerConnection);
        break;
    }
  };
  // myPeerConnection.onnegotiationneeded = async()=>{
  //   if(initiative_invite==true){   
  //   console.log("*** Negotiation needed");

  //   try {
  //     console.log("---> Creating offer");
  //     const offer = await myPeerConnection.createOffer();

  //     // If the connection hasn't yet achieved the "stable" state,
  //     // return to the caller. Another negotiationneeded event
  //     // will be fired when the state stabilizes.

  //     if (myPeerConnection.signalingState != "stable") {
  //       console.log("     -- The connection isn't stable yet; postponing...")
  //       return;
  //     }

  //     // Establish the offer as the local peer's current
  //     // description.

  //     console.log("---> Setting local description to the offer");
  //     await myPeerConnection.setLocalDescription(offer);

  //     // Send the offer to the remote peer.

  //     console.log("---> Sending the offer to the remote peer");
  //     sendToServer({
  //       name: myUsername,
  //       target: targetUsername,
  //       type: "video-offer",
  //       sdp: myPeerConnection.localDescription
  //     });
  //   } catch (err) {
  //     console.log("*** The following error occurred while handling the negotiationneeded event:");
  //     reportError(err);
  //   };
  // }

  // };
  myPeerConnection.ontrack = (event) => {
      console.log("*** Track event");

      var video_target="received_video"+video_index.toString();
      console.log(video_target,"  ====>target")
      document.getElementsByName(targetUsername)[0].srcObject = event.streams[0];
  

    
    console.log(event.streams[0])



  }
    ;
  return myPeerConnection;
}

// Called by the WebRTC layer to let us know when it's time to
// begin, resume, or restart ICE negotiation.

// function console.log(msg){
//   console.log(msg)

// }
// Called by the WebRTC layer when events occur on the media tracks
// on our WebRTC call. This includes when streams are added to and
// removed from the call.
//
// track events include the following fields:
//
// RTCRtpReceiver       receiver
// MediaStreamTrack     track
// MediaStream[]        streams
// RTCRtpTransceiver    transceiver
//
// In our case, we're just taking the first stream found and attaching
// it to the <video> element for incoming media.


// Handles |icecandidate| events by forwarding the specified
// ICE candidate (created by our local ICE agent) to the other
// peer through the signaling server.


// Given a message containing a list of usernames, this function
// populates the user list box with those names, making each item
// clickable to allow starting a video call.

function handleUserlistMsg(msg) {
  var i;
  var listElem = document.querySelector(".userlistbox");

  // Remove all current list members. We could do this smarter,
  // by adding and updating users instead of rebuilding from
  // scratch but this will do for this sample.

  while (listElem.firstChild) {
    listElem.removeChild(listElem.firstChild);
  }

  // Add member names from the received list.
  var container = document.querySelector("#container");
  if(msg.users.length==1){
    if(webcamStream)
    { 
    webcamStream.getTracks().forEach(track => track.stop());
  webcamStream=null;
}

  }


  msg.users.forEach(function (username) {
    var item = document.createElement("li");
    item.appendChild(document.createTextNode(username));
    listElem.appendChild(item);
    if(!userList.has(username)&& username!=myUsername ){

    userList.add(username)
      if(!document.getElementById(username)){
    var video_div = document.createElement("div");
    video_div.setAttribute("id",username)
    video_div.className="camerabox"
    video_div.innerHTML = `<video   name=` + username + ` autoplay></video>`
    container.append(video_div)
  }
  }

  });
}

async function change_stream(mediaspecies){
  if(mediaspecies=="camera"){
    webcamStream=await navigator.mediaDevices.getUserMedia(mediaConstraints)
  }else if(mediaspecies=="display"){
    webcamStream=await navigator.mediaDevices.getDisplayMedia(displayConstraints);
  }
  


  for(const item of userList){
    if(client_list[item])
    client_list[item].close();
    client_list[item]=null
    if ( !client_list[item] ) {
      document.getElementsByName(item)[0].srcObject=null
 await   invite(item)
    }
  }
}
  


 async function join_room(){
  
  console.log(userList)
  console.log(client_list)

  
  for(const item of userList){
    if ( !client_list[item] ) {

    invite(item).then(p=>console.log(p.signalingState)
    ,()=>console.log("xyz")
    )
    }
  }
  

}

// Close the RTCPeerConnection and reset variables so that the user can
// make or receive another call if they wish. This is called both
// when the user hangs up, the other user hangs up, or if a connection
// failure is detected.

 function closeVideoCall(myPeerConnection) {
  var localVideo = document.getElementById("local_video");

  console.log("Closing the call");

  // Close the RTCPeerConnection
  console.log(myPeerConnection)
  if (myPeerConnection) {
    console.log("--> Closing the peer connection");

    // Disconnect all our event listeners; we don't want stray events
    // to interfere with the hangup while it's ongoing.

    myPeerConnection.ontrack = null;
    myPeerConnection.onnicecandidate = null;
    myPeerConnection.oniceconnectionstatechange = null;
    myPeerConnection.onsignalingstatechange = null;
    myPeerConnection.onicegatheringstatechange = null;
    myPeerConnection.onnotificationneeded = null;

    // Stop all transceivers on the connection

    myPeerConnection.getTransceivers().forEach(transceiver => {
      transceiver.stop();
    });
    myPeerConnection.close();
    myPeerConnection = null;
    //webcamStream = null;
  }
  console.log(client_list)
  // Disable the hangup button

 // document.getElementById("hangup-button").disabled = true;
}

// Handle the "hang-up" message, which is sent if the other peer
// has hung up the call or otherwise disconnected.

async function handleHangUpMsg(msg) {
  console.log("*** Received hang up notification from other peer");
  console.log(msg.name)

 closeVideoCall(client_list[msg.name]);
  client_list[msg.name]=null
  console.log(client_list[msg.name])
}

// Hang up the call by closing our end of the connection, then
// sending a "hang-up" message to the other peer (keep in mind that
// the signaling is done on a different connection). This notifies
// the other peer that the connection should be terminated and the UI
// returned to the "no call in progress" state.

function hangUpCall() {
  Object.entries(client_list).forEach(([k,v])=>
{  
  closeVideoCall(v);
  client_list[k]=null;
  sendToServer({
    name: myUsername,
    target: k,
    type: "hang-up"
  });
})

}

// Handle a click on an item in the user list by inviting the clicked
// user to video chat. Note that we don't actually send a message to
// the callee here -- calling RTCPeerConnection.addTrack() issues
// a |notificationneeded| event, so we'll let our handler for that
// make the offer.

async function invite(targetUsername) {
  initiative_invite=true;
  console.log("Inviting user " + targetUsername);

  // Call createPeerConnection() to create the RTCPeerConnection.
  // When this returns, myPeerConnection is our RTCPeerConnection
  // and webcamStream is a stream coming from the camera. They are
  // not linked together in any way yet.

  console.log("Setting up connection to invite user: " + targetUsername);

  // Get access to the webcam stream and attach it to the
  // "preview" box (id "local_video").
  if(!webcamStream){ 

  try {
       //   webcamStream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);

    webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log(webcamStream)

   // document.getElementById("local_video").srcObject = webcamStream;
  } catch (err) {
    handleGetUserMediaError(err);
    return;
  }
}
  var myPeerConnection = await createPeerConnection(targetUsername);
  // Add the tracks from the stream to the RTCPeerConnection

  try {
    console.log("--------------->")
    // webcamStream.getTracks().forEach(
    //   track => myPeerConnection.addTransceiver(track, { streams: [webcamStream] })
    // );


  
    webcamStream.getTracks().forEach(
      track => {console.log("add tracks");myPeerConnection.addTrack(track,webcamStream)}
    );


    //console.log(myPeerConnection.getTransceivers())
  } catch (err) {
    handleGetUserMediaError(err);
  }
  
console.log("why you stop")
  medial_list[targetUsername]=true;
  client_list[targetUsername] = myPeerConnection;

  console.log(client_list[targetUsername])




      const offer = await myPeerConnection.createOffer();

      await myPeerConnection.setLocalDescription(offer);
      console.log(offer)


  sendToServer({
    name: myUsername,
    target: targetUsername,
    type: "video-offer",
    sdp: myPeerConnection.localDescription
  });
  return myPeerConnection

  //}
}

// Accept an offer to video chat. We configure our local settings,
// create our RTCPeerConnection, get and attach our local camera
// stream, then create and send an answer to the caller.



async function handleVideoOfferMsg(msg) {
  initiative_invite=false;
  console.log("in coming offer")
  targetUsername = msg.name;
  console.log(msg)

  // If we're not already connected, create an RTCPeerConnection
  // to be linked to the caller.

  console.log("Received video chat offer from " + targetUsername);
  // if (!myPeerConnection) {
  //   createPeerConnection();
  // }

  // We need to set the remote description to the received SDP offer
  // so that our local WebRTC layer knows how to talk to the caller.

  var desc = new RTCSessionDescription(msg.sdp);
  var myPeerConnection = null;
  // If the connection isn't stable yet, wait for it...
  if (!client_list[targetUsername]) {
    myPeerConnection = await createPeerConnection(targetUsername);
    client_list[targetUsername] = myPeerConnection;
    console.log("from here go")

  } else {
    myPeerConnection = client_list[msg.name]

  //   var stream=myPeerConnection.getLocalStreams()[0]
  //   let videoTrack = stream.getVideoTracks()[0];
  // let audioTrack = stream.getAudioTracks()[0];
  // myPeerConnection.removeTrack(videoTrack)
  //myPeerConnection.getSenders().forEach(sender=>myPeerConnection.removeTrack(sender))
    // myPeerConnection.getTransceivers().forEach(transceiver => {
    //   transceiver.stop();
    // });
//closeVideoCall( client_list[targetUsername])
    myPeerConnection.close();
  
    myPeerConnection = await createPeerConnection(targetUsername);
    client_list[targetUsername] = myPeerConnection;
    console.log("from here go")
  }
  console.log("被动之前 ",myPeerConnection.signalingState)


  
      //myPeerConnection.setLocalDescription({ type: "rollback" }).catch(reportError),
      //myPeerConnection.setRemoteDescription(desc)
 
    await myPeerConnection.setRemoteDescription(desc);
    console.log("被动之后 ",myPeerConnection.signalingState)


  console.log("jjjking")

  // Get the webcam stream if we don't already have it
  if (!webcamStream) {
    caller=false
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log(webcamStream)
    } catch (err) {
      handleGetUserMediaError(err);
      return;
    }

   // document.getElementById("local_video").srcObject = webcamStream;

    // Add the camera stream to the RTCPeerConnection

    // try {
    //   console.log("++++++++++++++")
    //   webcamStream.getTracks().forEach(
    //     track => myPeerConnection.addTrack(track,webcamStream)
    //   );
    //   medial_list[msg.name]=true;


    // } catch (err) {
    //   console.log("----------------------")

    //   handleGetUserMediaError(err);
    // }
  }
  //第二次来了一个新的
  // if(!medial_list[msg.name]){
  //   console.log("zzzzzz")
  //   // webcamStream.getTracks().forEach(
  //   //   track => myPeerConnection.addTransceiver(track, { streams: [webcamStream] })
  //   // );

  //   console.log("from here!!!!")


  // }
  medial_list[msg.name]=true;

  webcamStream.getTracks().forEach(
    track =>{myPeerConnection.addTrack(track,webcamStream)} 
  );

  console.log("---> Creating and sending answer to caller");
  const answer=await myPeerConnection.createAnswer();

  await myPeerConnection.setLocalDescription(answer).then(function (){  sendToServer({
    name: myUsername,
    target: targetUsername,
    type: "video-answer",
    sdp: myPeerConnection.localDescription
  });}).catch(reportError);

console.log("1111")
console.log(myPeerConnection.localDescription)
console.log(myPeerConnection.signalingState)

console.log("222")




}

// Responds to the "video-answer" message sent to the caller
// once the callee has decided to accept our request to talk.

async function handleVideoAnswerMsg(msg) {
  console.log("video answer ", msg.name)
  var myPeerConnection = client_list[msg.name]
 // console.log(myPeerConnection)
  console.log("*** Call recipient has accepted our call");

  // Configure the remote description, which is the SDP payload
  // in our "video-answer" message.

  var desc = new RTCSessionDescription(msg.sdp);
  await myPeerConnection.setRemoteDescription(desc).catch(reportError);
  console.log("set remote completely", myPeerConnection.signalingState);

}

// A new ICE candidate has been received from the other peer. Call
// RTCPeerConnection.addIceCandidate() to send it along to the
// local ICE framework.

async function handleNewICECandidateMsg(msg) {
  var myPeerConnection = client_list[msg.name]
  console.log(myPeerConnection)
  var candidate = new RTCIceCandidate(msg.candidate);

  console.log("*** Adding received ICE candidate: " + JSON.stringify(candidate));
  try {
    await myPeerConnection.addIceCandidate(candidate)
  } catch (err) {
    reportError(err);
  }
}

// Handle errors which occur when trying to access the local media
// hardware; that is, exceptions thrown by getUserMedia(). The two most
// likely scenarios are that the user has no camera and/or microphone
// or that they declined to share their equipment when prompted. If
// they simply opted not to share their media, that's not really an
// error, so we won't present a message in that situation.

function handleGetUserMediaError(e) {
  console.log_error(e);
  switch (e.name) {
    case "NotFoundError":
      alert("Unable to open your call because no camera and/or microphone" +
        "were found.");
      break;
    case "SecurityError":
    case "PermissionDeniedError":
      // Do nothing; this is the same as the user canceling the call.
      break;
    default:
      alert("Error opening your camera and/or microphone: " + e.message);
      break;
  }

  // Make sure we shut down our end of the RTCPeerConnection so we're
  // ready to try again.

  //closeVideoCall();
}

// Handles reporting errors. Currently, we just dump stuff to console but
// in a real-world application, an appropriate (and user-friendly)
// error message should be displayed.

function reportError(errMessage) {
  log_error(`Error ${errMessage.name}: ${errMessage.message}`);
}
