(() => {
    const shared = globalThis.MinecraftJukeboxShared;

    const JUKEBOX_DISC_ID = 'the_jukebox';
    const JUKEBOX_AUTOPLAY_COUNT = 10;

    const DISC_CATALOG = Object.freeze([
        { discId: '13', label: '13', imagePath: '/assets/images/13.webp' },
        { discId: 'cat', label: 'Cat', imagePath: '/assets/images/cat.webp', streamSources: ['https://dn710204.ca.archive.org/0/items/08-minecraft_202302/19%20-%20Cat.mp3'] },
        { discId: 'blocks', label: 'Blocks', imagePath: '/assets/images/blocks.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/28.%20Blocks.mp3'] },
        { discId: 'chirp', label: 'Chirp', imagePath: '/assets/images/chirp.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/20.%20Chirp.mp3'] },
        { discId: 'far', label: 'Far', imagePath: '/assets/images/far.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/29.%20Far.mp3'] },
        { discId: 'mall', label: 'Mall', imagePath: '/assets/images/mall.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/27.%20Mall.mp3'] },
        { discId: 'mellohi', label: 'Mellohi', imagePath: '/assets/images/mellohi.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/22.%20Mellohi.mp3'] },
        { discId: 'stal', label: 'Stal', imagePath: '/assets/images/stal.webp' },
        { discId: 'strad', label: 'Strad', imagePath: '/assets/images/strad.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/24.%20Strad.mp3'] },
        { discId: 'ward', label: 'Ward', imagePath: '/assets/images/ward.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/26.%20Ward.mp3'] },
        { discId: '11', label: '11', imagePath: '/assets/images/11.webp', streamSources: ['https://minecraft.wiki/images/11.ogg?348cd'] },
        { discId: 'wait', label: 'Wait', imagePath: '/assets/images/wait.webp', streamSources: ['https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/21.%20Wait.mp3'] },
        { discId: 'otherside', label: 'Otherside', imagePath: '/assets/images/otherside.webp' },
        { discId: '5', label: '5', imagePath: '/assets/images/5.webp' },
        { discId: 'pigstep', label: 'Pigstep', imagePath: '/assets/images/pigstep.webp', streamSources: ['https://dn721806.ca.archive.org/0/items/minecraft-nether-update-original-game-soundtrack-flac/04.%20Lena%20Raine%20-%20Pigstep%20%28Mono%20Mix%29.mp3'] },
        { discId: 'relic', label: 'Relic', imagePath: '/assets/images/relic.webp' },
        { discId: 'creator', label: 'Creator', imagePath: '/assets/images/Creator.webp' },
        { discId: 'creator_music_box', label: 'Creator (Music Box)', imagePath: '/assets/images/Creator(Music-Box).webp' },
        { discId: 'precipice', label: 'Precipice', imagePath: '/assets/images/Precipice.webp' },
        { discId: 'tears', label: 'Tears', imagePath: '/assets/images/Tears.webp' },
        { discId: 'lava_chicken', label: 'Lava Chicken', imagePath: '/assets/images/Lava-Chicken.webp' }
    ]);

    const JUKEBOX_TRACKS = Object.freeze([
        { title: 'Key', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/01%20-%20Key.mp3' },
        { title: 'Door', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/02%20-%20Door.mp3' },
        { title: 'Subwoofer Lullaby', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/03%20-%20Subwoofer%20Lullaby.mp3' },
        { title: 'Death', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/04%20-%20Death.mp3' },
        { title: 'Living Mice', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/05%20-%20Living%20Mice.mp3' },
        { title: 'Moog City', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/06%20-%20Moog%20City.mp3' },
        { title: 'Haggstrom', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/07%20-%20Haggstrom.mp3' },
        { title: 'Minecraft', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/08%20-%20Minecraft.mp3' },
        { title: 'Oxygene', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/09%20-%20Oxyg%C3%A8ne.mp3' },
        { title: 'Equinoxe', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/10%20-%20%C3%89quinoxe.mp3' },
        { title: 'Mice on Venus', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/11%20-%20Mice%20on%20Venus.mp3' },
        { title: 'Dry Hands', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/12%20-%20Dry%20Hands.mp3' },
        { title: 'Wet Hands', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/13%20-%20Wet%20Hands.mp3' },
        { title: 'Clark', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/14%20-%20Clark.mp3' },
        { title: 'Chris', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/15%20-%20Chris.mp3' },
        { title: 'Thirteen', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/16%20-%20Thirteen.mp3' },
        { title: 'Excuse', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/17%20-%20Excuse.mp3' },
        { title: 'Sweden', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/18%20-%20Sweden.mp3' },
        { title: 'Cat', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/19%20-%20Cat.mp3' },
        { title: 'Dog', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/20%20-%20Dog.mp3' },
        { title: 'Danny', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/21%20-%20Danny.mp3' },
        { title: 'Beginning', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/22%20-%20Beginning.mp3' },
        { title: 'Droopy Likes Ricochet', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/23%20-%20Droopy%20Likes%20Ricochet.mp3' },
        { title: 'Droopy Likes Your Face', url: 'https://dn710204.ca.archive.org/0/items/08-minecraft_202302/24%20-%20Droopy%20Likes%20Your%20Face.mp3' },
        { title: 'Ki', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/01.%20Ki.mp3' },
        { title: 'Alpha', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/02.%20Alpha.mp3' },
        { title: 'Dead Voxel', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/03.%20Dead%20Voxel.mp3' },
        { title: 'Blind Spots', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/04.%20Blind%20Spots.mp3' },
        { title: 'Flake', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/05.%20Flake.mp3' },
        { title: 'Moog City 2', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/06.%20Moog%20City%202.mp3' },
        { title: 'Concrete Halls', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/07.%20Concrete%20Halls.mp3' },
        { title: 'Biome Fest', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/08.%20Biome%20Fest.mp3' },
        { title: 'Mutation', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/09.%20Mutation.mp3' },
        { title: 'Haunt Muskie', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/10.%20Haunt%20Muskie.mp3' },
        { title: 'Warmth', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/11.%20Warmth.mp3' },
        { title: 'Floating Trees', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/12.%20Floating%20Trees.mp3' },
        { title: 'Aria Math', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/13.%20Aria%20Math.mp3' },
        { title: 'Kyoto', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/14.%20Kyoto.mp3' },
        { title: 'Ballad of the Cats', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/15.%20Ballad%20of%20the%20Cats.mp3' },
        { title: 'Taswell', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/16.%20Taswell.mp3' },
        { title: 'Beginning 2', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/17.%20Beginning%202.mp3' },
        { title: 'Dreiton', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/18.%20Dreiton.mp3' },
        { title: 'The End', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/19.%20The%20End.mp3' },
        { title: 'Chirp', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/20.%20Chirp.mp3' },
        { title: 'Wait', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/21.%20Wait.mp3' },
        { title: 'Mellohi', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/22.%20Mellohi.mp3' },
        { title: 'Stal', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/23%20Stal.mp3' },
        { title: 'Strad', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/24.%20Strad.mp3' },
        { title: 'Eleven', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/25.%20Eleven.mp3' },
        { title: 'Ward', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/26.%20Ward.mp3' },
        { title: 'Mall', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/27.%20Mall.mp3' },
        { title: 'Blocks', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/28.%20Blocks.mp3' },
        { title: 'Far', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/29.%20Far.mp3' },
        { title: 'Intro', url: 'https://archive.org/download/Minecraftostvolumebeta/C418-Minecraft%20Soundtrack%20Volume%20Beta/30.%20Intro.mp3' },
        { title: 'Chrysopoeia', url: 'https://archive.org/download/minecraft-nether-update-original-game-soundtrack-flac/01.%20Lena%20Raine%20-%20Chrysopoeia.mp3' },
        { title: 'Rubedo', url: 'https://archive.org/download/minecraft-nether-update-original-game-soundtrack-flac/02.%20Lena%20Raine%20-%20Rubedo.mp3' },
        { title: 'So Below', url: 'https://archive.org/download/minecraft-nether-update-original-game-soundtrack-flac/03.%20Lena%20Raine%20-%20So%20Below.mp3' },
        { title: 'Pigstep', url: 'https://archive.org/download/minecraft-nether-update-original-game-soundtrack-flac/04.%20Lena%20Raine%20-%20Pigstep%20%28Mono%20Mix%29.mp3' }
    ]);

    const DISC_BY_KEY = new Map(DISC_CATALOG.map(entry => [entry.discId, entry]));

    function slugifyForJukebox(value) {
        return String(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    const BACKGROUND_TRACKS = Object.freeze(JUKEBOX_TRACKS.map(track => {
        const isAlpha = track.url.includes('08-minecraft_202302');
        const isNether = track.url.includes('minecraft-nether-update');
        const album = isAlpha ? 'Volume Alpha' : isNether ? 'Nether Update' : 'Volume Beta';

        return Object.freeze({
            title: track.title,
            album,
            artist: isNether ? 'Lena Raine' : 'C418',
            discId: track.title,
            assetKey: `${JUKEBOX_DISC_ID}_${slugifyForJukebox(album)}_${slugifyForJukebox(track.title)}`,
            objectUrl: track.url,
            isStream: true
        });
    }));

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function isJukeboxDisc(discId) {
        return shared.toAssetKey(discId) === JUKEBOX_DISC_ID;
    }

    function getDiscMeta(discId) {
        const assetKey = shared.toAssetKey(discId);
        return assetKey ? DISC_BY_KEY.get(assetKey) || null : null;
    }

    function getStreamingSources(discId) {
        return getDiscMeta(discId)?.streamSources || [];
    }

    function hasStreamingSource(discId) {
        return getStreamingSources(discId).length > 0;
    }

    function canDiscStreamWithoutLibrary(discId) {
        return isJukeboxDisc(discId) || hasStreamingSource(discId);
    }

    function buildJukeboxTrackPayloads() {
        return shuffleArray(BACKGROUND_TRACKS.slice())
            .slice(0, JUKEBOX_AUTOPLAY_COUNT)
            .map(({ discId, assetKey, objectUrl, isStream }) => ({ discId, assetKey, objectUrl, isStream }));
    }

    globalThis.MinecraftJukeboxCatalog = {
        getPopupDiscs: () => DISC_CATALOG,
        getBackgroundTracks: () => BACKGROUND_TRACKS,
        getStreamingSources,
        hasStreamingSource,
        canDiscStreamWithoutLibrary,
        isJukeboxDisc,
        buildJukeboxTrackPayloads
    };
})();
