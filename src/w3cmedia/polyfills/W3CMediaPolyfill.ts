/*
 * Copyright Amazon.com, Inc. or its affiliates. All rights reserved.
 *
 * Vendored from github.com/AmazonAppDev/vega-video-sample, which is licensed
 * MIT No Attribution. The upstream copies carry a stale
 * "AMAZON PROPRIETARY/CONFIDENTIAL" header referring to a LICENSE.TXT that does
 * not exist in that repository; the repository LICENSE (MIT-0) governs. See
 * FRICTION.md entry 6.
 *
 * Shaka Player itself is Apache-2.0, (c) Google LLC — see LICENSE-THIRD-PARTY.
 */

// @ts-nocheck
//
import {
  requestMediaKeySystemAccess,
  MediaSource,
  HTMLMediaElement,
  TextTrackCue,
  VTTCue,
  decodingInfo as decodingInfoImpl,
} from '@amazon-devices/react-native-w3cmedia/dist/headless';

class W3CMediaPolyfill {
  static install() {
    console.log('Installing W3CMedia polyfills');
    global.window.MediaSource = global.MediaSource = MediaSource;
    global.window.TextTrackCue = global.TextTrackCue = TextTrackCue;
    global.window.VTTCue = global.VTTCue = VTTCue;
    window["TextTrackCue"] = TextTrackCue;
    if(!window.TextTrackCue) {
        console.log("TextTrackCue not polyfilled");
    }
    window["VTTCue"] = VTTCue;
    if(!window.VTTCue) {
      console.log("VTTCue not polyfilled");
    }
    global.navigator.requestMediaKeySystemAccess = requestMediaKeySystemAccess;
    global.navigator.mediaCapabilities = ({});
    global.navigator.mediaCapabilities.decodingInfo = decodingInfoImpl;
    global.HTMLMediaElement = HTMLMediaElement;
    global.Node = {};
    global.Node.TEXT_NODE = 3;
    global.Node.CDATA_SECTION_NODE = 4;
  }
}

export default W3CMediaPolyfill;
