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
import { WebCrypto } from "@amazon-devices/react-native-w3cmedia/dist/headless";
import {decode/*, encode*/} from 'base-64';

class MiscPolyfill {
    static install() {
        console.log("Installing misc polyfills");
        global.navigator.userAgent = "AFTCA001";
        global.window.fetch = fetch;
        global.window.addEventListener = (type: any, listener: any, options?: any) => {
            console.log(`adding window listener ${type}`);
        }
        global.window.removeEventListener = (
          type: any,
          listener: any,
          options?: any
        ) => {
          console.log(`removing window listener ${type}`);
        };
        global.window.console = console;
        global.window.crypto = WebCrypto;
        global.window.atob = decode;
    }
}

export default MiscPolyfill;
