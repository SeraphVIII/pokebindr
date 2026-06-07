// Side-effecting helpers for .pkbinder export/import.
//
// Export (Android-only): writes straight into the public Downloads folder
// via MediaStore — no SAF picker, no share sheet. Requires a development
// build because react-native-blob-util is a native module that Expo Go
// can't load.
//
// Import: opens the document picker, reads the chosen file, returns a
// validated PkBinderFile.

import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
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
  const filename = pkBinderFilename(binderName);

  // copyToMediaStore needs a source path — stage the JSON in the cache dir
  // first, then hand its path to the native module which moves it into
  // MediaStore.Downloads. The temp file gets cleaned up by the OS when
  // the cache is pruned; we delete it eagerly anyway.
  const staging = new File(Paths.cache, filename);
  if (staging.exists) staging.delete();
  staging.create();
  staging.write(json);

  // Strip the file:// prefix — the native module expects a bare path.
  const sourcePath = staging.uri.replace(/^file:\/\//, '');

  try {
    await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      { name: filename, parentFolder: '', mimeType: PKBINDER_MIME } as any,
      'Download',
      sourcePath,
    );
  } finally {
    if (staging.exists) staging.delete();
  }
  return filename;
}

/** Open the document picker, parse the chosen file, return a validated
 *  payload ready for useImportBinder. Resolves to `null` when the user
 *  cancels — the caller decides whether to toast or stay silent. */
export async function pickAndImportBinder(): Promise<PkBinderFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // No reliable MIME for our custom .pkbinder extension; accept JSON +
    // wildcard so the picker doesn't grey out our files on Android.
    type: ['application/json', '*/*'],
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
