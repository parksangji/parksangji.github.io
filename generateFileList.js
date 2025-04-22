const glob = require('glob');
const fs = require('fs');
const path = require('path');

glob('_notes/**/*.md', (err, files) => {
  if (err) {
    console.error(err);
    return;
  }

  const categories = {};

  files.forEach(file => {
    const relativePath = path.relative('_notes', file);
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
        nameWithoutExt: fileNameWithoutExt,
        category: category
      });
    }
  });

  const data = JSON.stringify({ categories: categories }, null, 2);
  fs.writeFileSync('_data/notes.json', data);
  console.log('_data/notes.json generated successfully!');
});
