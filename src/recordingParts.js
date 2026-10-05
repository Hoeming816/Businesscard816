/**
 * Long recordings are saved in parts of PART_SEC, each its own file (storage and
 * transcription both limit the size of one file). audio_path holds the parts'
 * paths, one per line, in order; a short recording is a single path as before.
 */
export const PART_SEC = 20 * 60;
export const audioParts = (i) => String(i?.audio_path || '').split('\n').map((p) => p.trim()).filter(Boolean);
export const joinAudioParts = (paths) => paths.filter(Boolean).join('\n') || null;
