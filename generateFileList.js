const glob = require('glob');
const fs = require('fs');
const path = require('path');

glob('_notes/**/*.md', (err, files) => { // obsidian 대신 _notes로 경로 수정
  if (err) {
    console.error(err);
    return;
  }

  const categories = {};

  files.forEach(file => {
    const relativePath = path.relative('_notes', file); // obsidian 대신 _notes로 경로 수정
    const parts = relativePath.split(path.sep);
    const category = parts[0];
    const fileNameWithExt = parts.slice(1).join(path.sep);
    const fileNameWithoutExt = fileNameWithExt.replace('.md', '');

    if (fileNameWithExt) {
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push({
        path: fileNameWithExt,
        fullPath: relativePath,
        nameWithoutExt: fileNameWithoutExt
      });
    }
  });

  const data = JSON.stringify({ categories: categories }, null, 2);
  fs.writeFileSync('_data/notes.json', data);
  console.log('_data/notes.json generated successfully!');
});
