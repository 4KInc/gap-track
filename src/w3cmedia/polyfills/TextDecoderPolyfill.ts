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
import { TextDecoder } from "@amazon-devices/react-native-w3cmedia/dist/headless";

class TextDecoderPolyfill {
  static install() {
    console.log("Installing TextDecoder polyfill");
    global.window.TextDecoder = TextDecoder;
  }
}

export default TextDecoderPolyfill;
