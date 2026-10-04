const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SAMPLE_AUDIO_PATH = path.join(__dirname, '..', 'fixtures', 'disc-sample.ogg');
const SAMPLE_HASH = 'aa00000000000000000000000000000000000000';

async function createLocalAssetsFixture(discKeys = ['13', 'stal']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-jukebox-assets-'));
    const indexesDir = path.join(root, 'indexes');
    const objectShardDir = path.join(root, 'objects', SAMPLE_HASH.slice(0, 2));
    const objectFilePath = path.join(objectShardDir, SAMPLE_HASH);

    await fs.mkdir(indexesDir, { recursive: true });
    await fs.mkdir(objectShardDir, { recursive: true });

    await fs.copyFile(SAMPLE_AUDIO_PATH, objectFilePath);

    const stats = await fs.stat(objectFilePath);
    const objects = {};
    for (const discKey of discKeys) {
        objects[`minecraft/sounds/records/${discKey}.ogg`] = {
            hash: SAMPLE_HASH,
            size: stats.size
        };
    }

    const indexPath = path.join(indexesDir, 'test-index.json');
    await fs.writeFile(indexPath, JSON.stringify({ objects }, null, 2));

    return {
        root,
        indexPath,
        objectFilePath
    };
}

async function cleanupFixture(fixture) {
    if (!fixture?.root) {
        return;
    }

    await fs.rm(fixture.root, { recursive: true, force: true });
}

module.exports = {
    cleanupFixture,
    createLocalAssetsFixture
};
