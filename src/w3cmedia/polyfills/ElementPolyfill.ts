// @ts-nocheck
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

declare global {
  namespace globalThis {
    var Element: any;
  }
}

class Element {
  tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  static install() {
    console.log('Installing Element Polyfill');
    global.Element = Element;
  }
}

export default Element;
