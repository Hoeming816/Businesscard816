// Saving a scanned card: as a new contact, or over an existing card for the
// same person. Shared by the one-card and several-cards scan pages.

import { overwritePatch } from './contactModel.js';

/**
 * Insert `row` as a new private card and upload its photos.
 * Returns { contact, failures } (failures: photo problems; the card is saved).
 * Throws when the card itself could not be saved.
 */
export async function saveNewCard(api, { row, workspaceId, uid, photos = {} }) {
  let contact = await api.insertContact({ ...row, workspace_id: workspaceId, created_by: uid, is_private: true });
  // Photos after the row exists (storage RLS checks the contact).
  const patch = {};
  const failures = [];
  for (const side of ['front', 'back']) {
    const img = photos[side];
    if (!img) continue;
    try {
      patch[`${side}_path`] = await api.uploadCardPhoto(workspaceId, contact.id, side, img.blob);
    } catch (e) {
      failures.push(`${side} photo: ${e.message}`);
    }
  }
  if (Object.keys(patch).length) {
    try {
      contact = (await api.updateContact(contact.id, patch)) || contact;
    } catch (e) {
      failures.push(e.message);
    }
  }
  return { contact, failures };
}

/**
 * Overwrite an existing card's details and photos with a newly scanned row;
 * notes, meetings and pipeline stay. Returns { contact, failures }.
 * Throws when the update itself fails.
 */
export async function updateCardFromScan(api, { target, row, workspaceId, photos = {} }) {
  const patch = overwritePatch(target, row);
  const failures = [];
  const replaced = [];
  for (const side of ['front', 'back']) {
    const img = photos[side];
    if (!img) continue;
    try {
      patch[`${side}_path`] = await api.uploadCardPhoto(workspaceId, target.id, side, img.blob);
      if (target[`${side}_path`]) replaced.push(target[`${side}_path`]);
    } catch (e) {
      failures.push(`${side} photo: ${e.message}`);
    }
  }
  const contact = Object.keys(patch).length ? await api.updateContact(target.id, patch) : target;
  if (replaced.length) api.removeStorageObjects('cards', replaced).catch(() => {});
  return { contact, failures };
}
