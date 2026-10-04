(() => {
    const catalog = globalThis.MinecraftJukeboxCatalog;
    const assets = globalThis.MinecraftJukeboxAssets;
    const PAGE_SIZE = 8;

    function normalizeSearch(value) {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function selectTrack(track, queueOnly) {
        const { discId, assetKey, objectUrl, isStream } = track;

        assets.setAssetsStatus(queueOnly ? `Added ${track.title} to the queue.` : '', queueOnly ? 'success' : null, {
            autoClear: queueOnly
        });

        chrome.runtime.sendMessage({
            type: queueOnly ? 'queueDisc' : 'playDisc',
            discId,
            assetKey,
            objectUrl,
            isStream
        }).catch(() => {
            assets.setAssetsStatus('Couldn’t reach the music player. Reopen the extension and try again.', 'error');
        });
    }

    function createTrackRow(track) {
        const row = document.createElement('li');
        row.className = 'song-item';
        row.dataset.songId = track.assetKey;

        const details = document.createElement('div');
        details.className = 'song-details';

        const title = document.createElement('span');
        title.className = 'song-title';
        title.textContent = track.title;

        const album = document.createElement('span');
        album.className = 'song-album';
        album.textContent = `${track.artist} · ${track.album}`;
        details.append(title, album);

        const actions = document.createElement('div');
        actions.className = 'song-actions';

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'control-btn song-play';
        play.textContent = 'Play';
        play.setAttribute('aria-label', `Play ${track.title}`);
        play.addEventListener('click', () => selectTrack(track, false));

        const queue = document.createElement('button');
        queue.type = 'button';
        queue.className = 'control-btn song-queue';
        queue.textContent = '+';
        queue.title = `Add ${track.title} to queue`;
        queue.setAttribute('aria-label', `Add ${track.title} to queue`);
        queue.addEventListener('click', () => selectTrack(track, true));
        actions.append(play, queue);

        row.append(details, actions);
        return row;
    }

    function initialize({ container, searchInput, countLabel, emptyLabel, pagination, pageRange, previousPage, nextPage }) {
        const tracks = catalog.getBackgroundTracks();
        const entries = tracks.map(track => ({
            row: createTrackRow(track),
            searchText: normalizeSearch(`${track.title} ${track.artist} ${track.album}`)
        }));
        container.replaceChildren(...entries.map(entry => entry.row));
        let matches = entries;
        let pageIndex = 0;

        function renderPage() {
            const first = pageIndex * PAGE_SIZE;
            const visible = new Set(matches.slice(first, first + PAGE_SIZE));
            entries.forEach(entry => { entry.row.hidden = !visible.has(entry); });
            container.hidden = matches.length === 0;
            pagination.hidden = matches.length <= PAGE_SIZE;
            previousPage.disabled = pageIndex === 0;
            nextPage.disabled = first + PAGE_SIZE >= matches.length;
            pageRange.textContent = matches.length
                ? `${first + 1}–${Math.min(first + PAGE_SIZE, matches.length)} of ${matches.length}`
                : '';
        }

        function changePage(direction) {
            const lastPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
            const nextIndex = Math.max(0, Math.min(lastPage, pageIndex + direction));
            if (nextIndex === pageIndex) return;
            const focused = document.activeElement;
            pageIndex = nextIndex;
            renderPage();
            // Keep keyboard users in the pager when a boundary disables the
            // control they just used. The other direction is still available.
            if (focused === previousPage && previousPage.disabled) nextPage.focus({ preventScroll: true });
            if (focused === nextPage && nextPage.disabled) previousPage.focus({ preventScroll: true });
            pagination.scrollIntoView({ block: 'nearest' });
        }

        previousPage.addEventListener('click', () => changePage(-1));
        nextPage.addEventListener('click', () => changePage(1));

        function filterTracks() {
            const query = normalizeSearch(searchInput.value);
            const words = query.split(/\s+/).filter(Boolean);
            matches = entries.filter(({ searchText }) => words.every(word => searchText.includes(word)));
            pageIndex = 0;

            countLabel.textContent = query
                ? `${matches.length} of ${tracks.length} tracks`
                : `${tracks.length} tracks`;
            emptyLabel.hidden = matches.length > 0;
            renderPage();
        }

        searchInput.addEventListener('input', filterTracks);
        // The native search-field clear control also emits a search event.
        searchInput.addEventListener('search', filterTracks);
        filterTracks();
    }

    globalThis.MinecraftJukeboxSongs = { initialize };
})();
