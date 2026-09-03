// Side-effecting helpers for .pkbinder export/import.

import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import {
  parsePkBinder,
  pkBinderFilename,
  PKBINDER_MIME,
  PkBinderFile,
  PkBinderParseError,
} from './pkbinder';

/** Write the JSON straight into the system Downloads folder on Android.
 *  Returns the on-disk filename so callers can surface it in a toast. */
export async function exportBinderToFile(
  json: string,
  binderName: string,
): Promise<string | null> {
  // Lazy require: react-native-blob-util is a native module Expo Go doesn't
  // ship, and a top-level import would crash every route pulling in this file.
  let RNBlobUtil: any;
  try {
    RNBlobUtil = require('react-native-blob-util').default;
  } catch {}
  if (!RNBlobUtil?.MediaCollection?.copyToMediaStore) {
    throw new Error('Exporting needs the installed app build — it is not available in Expo Go.');
  }

  const filename = pkBinderFilename(binderName);

  // copyToMediaStore needs a source path: stage the JSON in the cache dir,
  // then let the native module move it into MediaStore.Downloads.
  const staging = new File(Paths.cache, filename);
  if (staging.exists) staging.delete();
  staging.create();
  staging.write(json);

  // The native module expects a bare path without the file:// prefix.
  const sourcePath = staging.uri.replace(/^file:\/\//, '');

  try {
    await RNBlobUtil.MediaCollection.copyToMediaStore(
      { name: filename, parentFolder: '', mimeType: PKBINDER_MIME } as any,
      'Download',
      sourcePath,
    );
  } finally {
    if (staging.exists) staging.delete();
  }
  return filename;
}

/** Open the document picker, parse the chosen file, and return a validated
 *  payload. Resolves to `null` on cancel. */
export async function pickAndImportBinder(): Promise<PkBinderFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Android's picker filters by MIME, not extension; exports are tagged
    // application/json in MediaStore so they show under this filter.
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new PkBinderParseError('Could not read the chosen file.');
  }
  return parsePkBinder(text);
}
