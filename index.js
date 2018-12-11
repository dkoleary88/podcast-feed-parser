require('es6-promise').polyfill()
const fetch = require('isomorphic-fetch')
const parseString = require('xml2js').parseString

const ERRORS = exports.ERRORS = {
  'parsingError' : new Error("Parsing error."),
  'requiredError' : new Error("One or more required values are missing from feed."),
  'fetchingError' : new Error("Fetching error.")
}

// general function for extracting useful information from parsed feed
// if desired information is not present in feed, returns undefined
function getInfo (id, isRequired = false, isArray = false, cleanerFunction) {
  if (id) {
    if (isArray) {
      // if value is expected to be an array, returns the value of id
      if (cleanerFunction) {
        return cleanerFunction.call(this, id)
      } else {
        return id
      }
    } else {
      // if value is NOT an array, returns first element in id
      if (cleanerFunction) {
          return cleanerFunction.call(this, id[0])
      } else {
        return id[0]
      }
    }
  } else if (!id && isRequired === true) {
    throw ERRORS.requiredError
  } else {
    return undefined
  }
}

function getURL (object) {
  return object['$'].url
}

function getImageURL (object) {
  return object.url
}

function getHREF (object) {
  return object['$'].href
}

function getGUID (object) {
  return object._
}

function cleanExplicit (string) {
  if (['yes', 'explicit', 'true'].indexOf(string.toLowerCase()) >= 0) {
    return true
  } else if (['clean', 'no', 'false'].indexOf(string.toLowerCase()) >= 0) {
    return false
  } else {
    return undefined
  }
}

function cleanTruth (string) {
  if (string.toLowerCase == 'yes') {
    return true
  } else {
    return false
  }
}

function cleanDate (string) {
  return new Date(string)
}

function cleanOwner (object) {
  return {
    name: object["itunes:name"][0],
    email: object["itunes:email"][0]
  }
}

function cleanDuration (string) {
  // gives duration in seconds
  let times = string.split(':'),
  sum = 0, mul = 1

  while (times.length > 0) {
    sum += mul * parseInt(times.pop())
    mul *= 60
  }

  return sum
}

function cleanCategories (array) {
  // returns categories as an array containing each category/sub-category
  // grouping in lists. If there is a sub-category, it is the second element
  // of an array.
  const categoriesArray = array.map( item => {
    let category = []
    category.push(item['$'].text) // primary category
    if (item['itunes:category']) { // sub-category
      category.push(item['itunes:category'][0]['$'].text)
    }
    return category
  })

  return categoriesArray
}

function parseXMLFeed (feedText) {
  return new Promise((resolve, reject) => {
        parseString(feedText, (error, result) => {
            if (error) { reject(error) }
            resolve(result)
        })
    })
}

function parseLocalXMLFeed (feedText) {
    let feed = {}
    parseString(feedText, (error, result) => {
      if (error) {
        throw ERRORS.parsingError
      }
      Object.assign(feed, result)
      return result
    })
    return (feed)
}

async function fetchFeed (url) {
  try {
    const feedResponse = await fetch(url)
    const feedText = await feedResponse.text()
    const feedObject = await parseXMLFeed(feedText)
    return feedObject
  } catch (err) {
    throw ERRORS.fetchingError
  }
}

// function builds episode objects from parsed podcast feed
function createEpisodesObjectFromFeed (channel, options) {
  let episodes = []
  channel.item.forEach( (item) => {
    episodes.push({
      title: getInfo(item.title, true),
      guid: getInfo(item.guid, true, false, getGUID),
      language: getInfo(channel.language, false, true),
      link: getInfo(item.link),
      imageURL: getInfo(item["itunes:image"], false, false, getHREF),
      publicationDate: getInfo(item.pubDate, false, false, cleanDate),
      audioFileURL: getInfo(item.enclosure, true, false, getURL),
      duration: getInfo(item["itunes:duration"], false, false, cleanDuration),
      description: getInfo(item.description),
      subtitle: getInfo(item["itunes:subtitle"]),
      summary: getInfo(item["itunes:summary"]),
      blocked: getInfo(item["itunes:block"], false, false, cleanTruth),
      explicit: getInfo(item["itunes:explicit"], false, false, cleanExplicit),
      order: getInfo(item["itunes:order"])
    })
  })

  episodes.sort(
    function (a, b) {
      // sorts by order first, if defined, then sorts by date.
      // if multiple episodes were published at the same time,
      // they are then sorted by title
      if (a.order == b.order) {
        if (a.publicationDate.getTime() == b.publicationDate.getTime()) {
          return a.title > b.title ? -1 : 1
        }
        return b.publicationDate > a.publicationDate ? 1 : -1
      }

      if (a.order && !b.order) {
        return 1
      }

      if (b.order && !a.order) {
        return -1
      }

      return a.order > b.order ? -1 : 1
    }
  )

  return episodes
}

function get_imageURL (node) {

  if (node.image) {
    return node.image[0].url
  }

  if (node["itunes:image"]) {
    return node["itunes:image"]['$'].href
  }

  return undefined

}

function get_title (node) {
  return node.title
}

function get_description (node) {
  return node.description
}

function createMetaObjectFromFeed (channel, options) {
  const meta = {
    title: getInfo(channel.title, true),
    guid: getInfo(channel.guid, false, false, getGUID),
    description: getInfo(channel.description, true),
    subtitle: getInfo(channel["itunes:subtitle"]),
    imageURL: getInfo(channel.image, true, false, getImageURL),
    lastUpdated: getInfo(channel.lastBuildDate, false, false, cleanDate),
    link: getInfo(channel.link),
    language: getInfo(channel.language, false, true),
    editor: getInfo(channel.managingEditor),
    author: getInfo(channel["itunes:author"]),
    summary: getInfo(channel["itunes:summary"]),
    categories: getInfo(channel["itunes:category"], false, true, cleanCategories),
    owner: getInfo(channel["itunes:owner"], false, false, cleanOwner),
    explicit: getInfo(channel["itunes:explicit"], false, false, cleanExplicit),
    complete: getInfo(channel["itunes:complete"], false, false, cleanTruth),
    blocked: getInfo(channel["itunes:block"], false, false, cleanTruth)
  }
  return meta
}

const getPodcastFromURL = exports.getPodcastFromURL = async function (url) {
  try {
    const feedResponse = await fetchFeed(url)
    const channel = feedResponse.rss.channel[0]

    if (channel["itunes:new-feed-url"]) {
      getPodcastFromURL(channel["itunes:new-feed-url"])
    }

    const meta = createMetaObjectFromFeed(channel)
    const episodes = createEpisodesObjectFromFeed(channel)

    return {meta, episodes}
  }
  catch (err) {
    // throw err
    throw err
  }
}

const getPodcastFromFeed = exports.getPodcastFromFeed = function (feed) {
  try {
    const feedObject = parseLocalXMLFeed(feed)
    const channel = feedObject.rss.channel[0]

    if (channel["itunes:new-feed-url"]) {
      getPodcastFromURL(channel["itunes:new-feed-url"])
    }

    const meta = createMetaObjectFromFeed(channel)
    const episodes = createEpisodesObjectFromFeed(channel)

    return {meta, episodes}
  }
  catch (err) {
    throw err
  }
}

// const url = "http://feeds.gimletmedia.com/hearreplyall"
// const url = "http://onmargins.craigmod.com/rss"
// const url = "https://allthingschemical.libsyn.com/rss"
// const url = "http://localhost:7000/testrss.xml"
// testCreatePodcastFeedObject(url)
// const url = "http://feeds.gimletmedia.com/hearreplyall"
// printPodcast(url)
// writePodcast(url)
