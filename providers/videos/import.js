

async function importer({
        config,
        axios,
        lodash,
        logger,
        videosRepository,
        imageRepository
    }) {

    const { apiKey, channelId } = config

    const api = axios.create({
        baseURL: 'https://www.googleapis.com/youtube/v3',
    })

    function findChannel(key, id) {
        const params = {
            key,
            id,
            part: 'contentDetails',
        }

        return api
            .get('channels', { params })
            .then((response) => lodash.get(response, 'data.items[0]', null))
            .catch(() => null)
    }

    function findPlaylistItems(key, playlistId, pageToken){
        const params = {
            key,
            playlistId,
            pageToken,
            maxResults: 50,
            part: "contentDetails",
        }

        return api
            .get('playlistItems', { params })
            .then((response) => ({
                nextPageToken: lodash.get(response, 'data.nextPageToken', null),
                items: lodash.get(response, 'data.items', [])
            }))
            .catch(() => [])
    }

    async function findVideos(key, uploadPlaylistId, pageToken) {
        const { items, nextPageToken } = await findPlaylistItems(key, uploadPlaylistId, pageToken)

        const videoIds = items.map(i => lodash.get(i, 'contentDetails.videoId', null)) 

        const params = {
            key,
            part: "statistics, snippet",
            id: videoIds.join(),
        }
        
        return api.get('videos', { params })
            .then(response => ({
                nextPageToken,
                items: lodash.get(response, 'data.items', []),
            }))
            .catch(() => [])

    }

    async function createVideos(videos){
        const videosPayload = []
        const thumbnailsPayload = []
        const viewsPayload = []
    
        videos.map(video => {    
            videosPayload.push({
                videoId: lodash.get(video, 'id', null),
                source: 'youtube',
                title: lodash.get(video, 'snippet.title', null),
                src: `https://www.youtube.com/embed/${video.id}`,
                description: lodash.get(video, 'snippet.description', null),
            })

            viewsPayload.push({
                videoId: lodash.get(video, 'id', null),
                source: 'youtube',
                count: lodash.get(video, 'statistics.viewCount', 0),
            })
    
            Object.entries(lodash.get(video, 'snippet.thumbnails', {})).map(([key, value]) => {
                thumbnailsPayload.push({
                    name: key,
                    videoId: lodash.get(video, 'id', null),
                    source: 'youtube',
                    src: value.url,
                    alt: lodash.get(video, 'snippet.title', null),
                })
            })
        })
    
        await videosRepository.createMany(videosPayload)
    
        await videosRepository.createThumbnails(thumbnailsPayload)

        await videosRepository.createViews(viewsPayload)
    }


    const channel = await findChannel(apiKey, channelId)

    if (!channel) {
        throw new Error('Api key or channel invalid')
    }

    const uploadPlaylistId = lodash.get(channel, 'contentDetails.relatedPlaylists.uploads')

    async function start(pageToken){
        const { items, nextPageToken } = await findVideos(apiKey, uploadPlaylistId, pageToken)
    
        logger.info('[youtube-provider] importing page %s', pageToken || '1')

        await createVideos(items)

        if (nextPageToken) {
            await new Promise(resolve => setTimeout(resolve, 5000))
            await start(nextPageToken)
        }

    }

    await start()
}

module.exports = importer
