'use strict';
// Minimal in-memory Drive: folders by id, some readable, some read-only.
function fakeDrive({ readOnly = [] } = {}) {
  const folders = new Map();
  let n = 0;
  const mk = (id, name, parent) => {
    const f = {
      id, name, parent, children: [], files: [],
      getId: () => id, getName: () => name, getUrl: () => `https://drive.google.com/drive/folders/${id}`,
      getOwner: () => ({ getEmail: () => 'owner@example.com' }),
      getFoldersByName: (nm) => { const list = f.children.filter((c) => c.name === nm); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
      getFilesByName: () => ({ hasNext: () => false }),
      createFolder: (nm) => { const c = mk(`sub${++n}`, nm, f); f.children.push(c); return c; },
      createFile: (nm) => { if (readOnly.includes(id)) throw new Error('Access denied'); const fid = `1FakeDriveFile${String(++n).padStart(19, '0')}`; /* Drive-like: stable and 33 chars */ const file = { name: nm, trashed: false, setTrashed(v) { this.trashed = v; }, getId: () => fid }; f.files.push(file); return file; },
    };
    folders.set(id, f);
    return f;
  };
  const api = {
    folders,
    add: (id, name) => mk(id, name, null),
    getFolderById: (id) => { const f = folders.get(id); if (!f) throw new Error('No item with the given ID could be found'); return f; },
    getFileById: () => ({ getParents: () => ({ hasNext: () => false }) }),
    getRootFolder: () => api.add('root', 'My Drive'),
    pathOf: (f) => { const parts = []; while (f) { parts.unshift(f.name); f = f.parent; } return parts.join('/'); },
  };
  return api;
}

module.exports = { fakeDrive };
