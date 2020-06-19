/********************************************************************************
 * Copyright (C) 2020 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as iconv from 'iconv-lite';
import { Buffer } from 'safer-buffer';
import { injectable, inject } from 'inversify';
import URI from '../common/uri';
import { TextBuffer } from '../common/buffer';
import { Disposable } from 'vscode-ws-jsonrpc';
import { CorePreferences } from './core-preferences';

export const UTF8 = 'utf8';
export const UTF8_with_bom = 'utf8bom';
export const UTF16be = 'utf16be';
export const UTF16le = 'utf16le';

export const UTF16be_BOM = [0xFE, 0xFF];
export const UTF16le_BOM = [0xFF, 0xFE];
export const UTF8_BOM = [0xEF, 0xBB, 0xBF];

const ZERO_BYTE_DETECTION_BUFFER_MAX_LEN = 512; 	// number of bytes to look at to decide about a file being binary or not
const AUTO_ENCODING_GUESS_MAX_BYTES = 512 * 128; 	// set an upper limit for the number of bytes we pass on to jschardet

// we explicitly ignore a specific set of encodings from auto guessing
// - ASCII: we never want this encoding (most UTF-8 files would happily detect as
//          ASCII files and then you could not type non-ASCII characters anymore)
// - UTF-16: we have our own detection logic for UTF-16
// - UTF-32: we do not support this encoding in VSCode
const IGNORE_ENCODINGS = ['ascii', 'utf-16', 'utf-32'];

export const SUPPORTED_ENCODINGS: { [encoding: string]: { labelLong: string; labelShort: string; order: number; encodeOnly?: boolean; alias?: string } } = {
    utf8: {
        labelLong: 'UTF-8',
        labelShort: 'UTF-8',
        order: 1,
        alias: 'utf8bom'
    },
    utf8bom: {
        labelLong: 'UTF-8 with BOM',
        labelShort: 'UTF-8 with BOM',
        encodeOnly: true,
        order: 2,
        alias: 'utf8'
    },
    utf16le: {
        labelLong: 'UTF-16 LE',
        labelShort: 'UTF-16 LE',
        order: 3
    },
    utf16be: {
        labelLong: 'UTF-16 BE',
        labelShort: 'UTF-16 BE',
        order: 4
    },
    windows1252: {
        labelLong: 'Western (Windows 1252)',
        labelShort: 'Windows 1252',
        order: 5
    },
    iso88591: {
        labelLong: 'Western (ISO 8859-1)',
        labelShort: 'ISO 8859-1',
        order: 6
    },
    iso88593: {
        labelLong: 'Western (ISO 8859-3)',
        labelShort: 'ISO 8859-3',
        order: 7
    },
    iso885915: {
        labelLong: 'Western (ISO 8859-15)',
        labelShort: 'ISO 8859-15',
        order: 8
    },
    macroman: {
        labelLong: 'Western (Mac Roman)',
        labelShort: 'Mac Roman',
        order: 9
    },
    cp437: {
        labelLong: 'DOS (CP 437)',
        labelShort: 'CP437',
        order: 10
    },
    windows1256: {
        labelLong: 'Arabic (Windows 1256)',
        labelShort: 'Windows 1256',
        order: 11
    },
    iso88596: {
        labelLong: 'Arabic (ISO 8859-6)',
        labelShort: 'ISO 8859-6',
        order: 12
    },
    windows1257: {
        labelLong: 'Baltic (Windows 1257)',
        labelShort: 'Windows 1257',
        order: 13
    },
    iso88594: {
        labelLong: 'Baltic (ISO 8859-4)',
        labelShort: 'ISO 8859-4',
        order: 14
    },
    iso885914: {
        labelLong: 'Celtic (ISO 8859-14)',
        labelShort: 'ISO 8859-14',
        order: 15
    },
    windows1250: {
        labelLong: 'Central European (Windows 1250)',
        labelShort: 'Windows 1250',
        order: 16
    },
    iso88592: {
        labelLong: 'Central European (ISO 8859-2)',
        labelShort: 'ISO 8859-2',
        order: 17
    },
    cp852: {
        labelLong: 'Central European (CP 852)',
        labelShort: 'CP 852',
        order: 18
    },
    windows1251: {
        labelLong: 'Cyrillic (Windows 1251)',
        labelShort: 'Windows 1251',
        order: 19
    },
    cp866: {
        labelLong: 'Cyrillic (CP 866)',
        labelShort: 'CP 866',
        order: 20
    },
    iso88595: {
        labelLong: 'Cyrillic (ISO 8859-5)',
        labelShort: 'ISO 8859-5',
        order: 21
    },
    koi8r: {
        labelLong: 'Cyrillic (KOI8-R)',
        labelShort: 'KOI8-R',
        order: 22
    },
    koi8u: {
        labelLong: 'Cyrillic (KOI8-U)',
        labelShort: 'KOI8-U',
        order: 23
    },
    iso885913: {
        labelLong: 'Estonian (ISO 8859-13)',
        labelShort: 'ISO 8859-13',
        order: 24
    },
    windows1253: {
        labelLong: 'Greek (Windows 1253)',
        labelShort: 'Windows 1253',
        order: 25
    },
    iso88597: {
        labelLong: 'Greek (ISO 8859-7)',
        labelShort: 'ISO 8859-7',
        order: 26
    },
    windows1255: {
        labelLong: 'Hebrew (Windows 1255)',
        labelShort: 'Windows 1255',
        order: 27
    },
    iso88598: {
        labelLong: 'Hebrew (ISO 8859-8)',
        labelShort: 'ISO 8859-8',
        order: 28
    },
    iso885910: {
        labelLong: 'Nordic (ISO 8859-10)',
        labelShort: 'ISO 8859-10',
        order: 29
    },
    iso885916: {
        labelLong: 'Romanian (ISO 8859-16)',
        labelShort: 'ISO 8859-16',
        order: 30
    },
    windows1254: {
        labelLong: 'Turkish (Windows 1254)',
        labelShort: 'Windows 1254',
        order: 31
    },
    iso88599: {
        labelLong: 'Turkish (ISO 8859-9)',
        labelShort: 'ISO 8859-9',
        order: 32
    },
    windows1258: {
        labelLong: 'Vietnamese (Windows 1258)',
        labelShort: 'Windows 1258',
        order: 33
    },
    gbk: {
        labelLong: 'Simplified Chinese (GBK)',
        labelShort: 'GBK',
        order: 34
    },
    gb18030: {
        labelLong: 'Simplified Chinese (GB18030)',
        labelShort: 'GB18030',
        order: 35
    },
    cp950: {
        labelLong: 'Traditional Chinese (Big5)',
        labelShort: 'Big5',
        order: 36
    },
    big5hkscs: {
        labelLong: 'Traditional Chinese (Big5-HKSCS)',
        labelShort: 'Big5-HKSCS',
        order: 37
    },
    shiftjis: {
        labelLong: 'Japanese (Shift JIS)',
        labelShort: 'Shift JIS',
        order: 38
    },
    eucjp: {
        labelLong: 'Japanese (EUC-JP)',
        labelShort: 'EUC-JP',
        order: 39
    },
    euckr: {
        labelLong: 'Korean (EUC-KR)',
        labelShort: 'EUC-KR',
        order: 40
    },
    windows874: {
        labelLong: 'Thai (Windows 874)',
        labelShort: 'Windows 874',
        order: 41
    },
    iso885911: {
        labelLong: 'Latin/Thai (ISO 8859-11)',
        labelShort: 'ISO 8859-11',
        order: 42
    },
    koi8ru: {
        labelLong: 'Cyrillic (KOI8-RU)',
        labelShort: 'KOI8-RU',
        order: 43
    },
    koi8t: {
        labelLong: 'Tajik (KOI8-T)',
        labelShort: 'KOI8-T',
        order: 44
    },
    gb2312: {
        labelLong: 'Simplified Chinese (GB 2312)',
        labelShort: 'GB 2312',
        order: 45
    },
    cp865: {
        labelLong: 'Nordic DOS (CP 865)',
        labelShort: 'CP 865',
        order: 46
    },
    cp850: {
        labelLong: 'Western European DOS (CP 850)',
        labelShort: 'CP 850',
        order: 47
    }
};

export interface ResourceEncoding {
    encoding: string
    hasBOM: boolean
}

export interface EncodingOverride {
    parent?: URI;
    extension?: string;
    scheme?: string;
    encoding: string;
}

export interface DetectedEncoding {
    encoding?: string
    seemsBinary?: boolean
}

@injectable()
export class EncodingService {

    protected readonly encodingOverrides: EncodingOverride[] = [];

    @inject(CorePreferences)
    protected readonly preferences: CorePreferences;

    registerOverride(override: EncodingOverride): Disposable {
        this.encodingOverrides.push(override);
        return Disposable.create(() => {
            const index = this.encodingOverrides.indexOf(override);
            if (index !== -1) {
                this.encodingOverrides.splice(index, 1);
            }
        });
    }

    encode(value: string, options?: ResourceEncoding): TextBuffer {
        let encoding = options?.encoding;
        const addBOM = options?.hasBOM;
        encoding = this.toIconvEncoding(encoding);
        if (encoding === UTF8 && !addBOM) {
            return TextBuffer.fromString(value);
        }
        const buffer = iconv.encode(value, encoding, { addBOM });
        return TextBuffer.wrap(buffer);
    }

    decode(value: TextBuffer, encoding?: string): string {
        const buffer = Buffer.from(value.buffer);
        encoding = this.toIconvEncoding(encoding);
        return iconv.decode(buffer, encoding);
    }

    getEncodingForResource(resource: URI, preferredEncoding?: string): string {
        let fileEncoding: string;

        const override = this.getEncodingOverride(resource);
        if (override) {
            fileEncoding = override; // encoding override always wins
        } else if (preferredEncoding) {
            fileEncoding = preferredEncoding; // preferred encoding comes second
        } else {
            fileEncoding = this.preferences.get('files.encoding', undefined, resource.toString());
        }

        if (!fileEncoding || !this.exists(fileEncoding)) {
            return UTF8; // the default is UTF 8
        }

        return this.toIconvEncoding(fileEncoding);
    }

    protected getEncodingOverride(resource: URI): string | undefined {
        if (this.encodingOverrides && this.encodingOverrides.length) {
            for (const override of this.encodingOverrides) {
                if (override.parent && resource.isEqualOrParent(override.parent)) {
                    return override.encoding;
                }

                if (override.extension && resource.path.ext === `.${override.extension}`) {
                    return override.encoding;
                }

                if (override.scheme && override.scheme === resource.scheme) {
                    return override.encoding;
                }
            }
        }

        return undefined;
    }

    protected exists(encoding: string): boolean {
        encoding = this.toIconvEncoding(encoding);
        return iconv.encodingExists(encoding);
    }

    protected toIconvEncoding(encoding?: string): string {
        if (encoding === UTF8_with_bom || !encoding) {
            return UTF8; // iconv does not distinguish UTF 8 with or without BOM, so we need to help it
        }
        return encoding;
    }

    async detectEncoding(data: TextBuffer, autoGuessEncoding?: boolean): Promise<DetectedEncoding> {
        const buffer = Buffer.from(data.buffer);
        const bytesRead = data.byteLength;
        // Always first check for BOM to find out abouÏt encoding
        let encoding = this.detectEncodingByBOMFromBuffer(buffer, bytesRead);

        // Detect 0 bytes to see if file is binary or UTF-16 LE/BEÏ
        // unless we already know that this file has a UTF-16 encoding
        let seemsBinary = false;
        if (encoding !== UTF16be && encoding !== UTF16le && buffer) {
            let couldBeUTF16LE = true; // e.g. 0xAA 0x00
            let couldBeUTF16BE = true; // e.g. 0x00 0xAA
            let containsZeroByte = false;

            // This is a simplified guess to detect UTF-16 BE or LE by just checking if
            // the first 512 bytes have the 0-byte at a specific location. For UTF-16 LE
            // this would be the odd byte index and for UTF-16 BE the even one.
            // Note: this can produce false positives (a binary file that uses a 2-byte
            // encoding of the same format as UTF-16) and false negatives (a UTF-16 file
            // that is using 4 bytes to encode a character).
            for (let i = 0; i < bytesRead && i < ZERO_BYTE_DETECTION_BUFFER_MAX_LEN; i++) {
                const isEndian = (i % 2 === 1); // assume 2-byte sequences typical for UTF-16
                const isZeroByte = (buffer.readUInt8(i) === 0);

                if (isZeroByte) {
                    containsZeroByte = true;
                }

                // UTF-16 LE: expect e.g. 0xAA 0x00
                if (couldBeUTF16LE && (isEndian && !isZeroByte || !isEndian && isZeroByte)) {
                    couldBeUTF16LE = false;
                }

                // UTF-16 BE: expect e.g. 0x00 0xAA
                if (couldBeUTF16BE && (isEndian && isZeroByte || !isEndian && !isZeroByte)) {
                    couldBeUTF16BE = false;
                }

                // Return if this is neither UTF16-LE nor UTF16-BE and thus treat as binary
                if (isZeroByte && !couldBeUTF16LE && !couldBeUTF16BE) {
                    break;
                }
            }

            // Handle case of 0-byte included
            if (containsZeroByte) {
                if (couldBeUTF16LE) {
                    encoding = UTF16le;
                } else if (couldBeUTF16BE) {
                    encoding = UTF16be;
                } else {
                    seemsBinary = true;
                }
            }
        }

        // Auto guess encoding if configured
        if (autoGuessEncoding && !seemsBinary && !encoding && buffer) {
            const guessedEncoding = await this.guessEncodingByBuffer(buffer.slice(0, bytesRead));
            return {
                seemsBinary: false,
                encoding: guessedEncoding
            };
        }

        return { seemsBinary, encoding };
    }

    detectEncodingByBOMFromBuffer(buffer: Buffer, bytesRead: number): typeof UTF8_with_bom | typeof UTF16le | typeof UTF16be | undefined {
        if (!buffer || bytesRead < UTF16be_BOM.length) {
            return undefined;
        }

        const b0 = buffer.readUInt8(0);
        const b1 = buffer.readUInt8(1);

        // UTF-16 BE
        if (b0 === UTF16be_BOM[0] && b1 === UTF16be_BOM[1]) {
            return UTF16be;
        }

        // UTF-16 LE
        if (b0 === UTF16le_BOM[0] && b1 === UTF16le_BOM[1]) {
            return UTF16le;
        }

        if (bytesRead < UTF8_BOM.length) {
            return undefined;
        }

        const b2 = buffer.readUInt8(2);

        // UTF-8
        if (b0 === UTF8_BOM[0] && b1 === UTF8_BOM[1] && b2 === UTF8_BOM[2]) {
            return UTF8_with_bom;
        }

        return undefined;
    }

    protected async guessEncodingByBuffer(buffer: Buffer): Promise<string | undefined> {
        const jschardet = await import('jschardet');

        const guessed = jschardet.detect(buffer.slice(0, AUTO_ENCODING_GUESS_MAX_BYTES)); // ensure to limit buffer for guessing due to https://github.com/aadsm/jschardet/issues/53
        if (!guessed || !guessed.encoding) {
            return undefined;
        }

        const enc = guessed.encoding.toLowerCase();
        if (0 <= IGNORE_ENCODINGS.indexOf(enc)) {
            return undefined; // see comment above why we ignore some encodings
        }

        return this.toIconvEncoding(guessed.encoding);
    }

}
