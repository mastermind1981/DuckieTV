/**
 * Episode watched monitor
 * Count all episodes watched for a season when changes occur, flip switches accordingly.
 */
DuckieTV.factory('watchedCounter', function($q, FavoritesService) {

    var queue = {

    };
    var queueTimer = null;

    /**
     * Parse the episodes count returned from the recountSerie function into an object with season keys.
     * format:
     * {
     *   seasonID : { watched: <int>, notWatched: int },
     *   [...]
     * }
     * @return Object with season watched episode counts
     */
    function parseEpisodeCounts(counts) {
        var seasons = {};
        var seasonsWatched = 0;
        for (var i = 0; i < counts.rs.rows.length; i++) {
            var row = counts.rs.rows.item(i);
            if (!(row.ID_Season in seasons)) {
                seasons[row.ID_Season] = {
                    watched: 0,
                    notWatched: 0
                };
            }
            seasons[row.ID_Season][row.watched === 0 ? 'notWatched' : 'watched'] = row.amount;
        }
        return seasons;
    }

    /**
     * Iterate the output from parseEpisodeCounts
     * and mark every season as either watched or not watched based if notWatched = 0 (indicating that all episodes are watched)
     * Persist new season watched statuses, and return an intermediate array with boolean values that have a true/false for
     * every serie. reduce the boolean array into a single digit representing watched seasons for serie.
     * Return boolean that tells if number of seasons in the show matches watched season count.
     *
     * @return boolean allSeasonsWatched
     */
    function markSeasonsWatched(seasons) {
        return $q.all(Object.keys(seasons).map(function(season) {
            return CRUD.FindOne('Season', {
                ID_Season: season
            }).then(function(s) {
                s.watched = seasons[season].notWatched === 0 ? 1 : 0;
                //console.debug("Season watched? ", season, s.watched === 1);
                s.Persist();
                return s.watched === 1 ? true : false;
            });
        })).then(function(result) {
            var watchedSeasonCount = result.reduce(function(prev, current) {
                return prev + (current === true ? 1 : 0);
            }, 0);
            var allSeasonsWatched = Object.keys(seasons).length == watchedSeasonCount;
            return allSeasonsWatched;
        });
    }

    /**
     * Fetch serie from favoritesservice for performance and toggle watched flag.
     */
    function markSerieWatched(ID_Serie, allSeasonsWatched) {
        var serie = FavoritesService.getByID_Serie(ID_Serie);
        //console.debug("Serie watched? ", serie.name, serie.watched, allSeasonsWatched);
        serie.watched = allSeasonsWatched;
        serie.Persist();
    }

    /**
     * When all database queries are done, process a serie.
     * If not, delay processing for 50ms.
     */
    function processQueue() {
        if (CRUD.stats.writesExecuted == CRUD.stats.writesQueued) {
            var ID_Serie = Object.keys(queue)[0];
            delete queue[ID_Serie];
            processSerie(ID_Serie);
        }
        if (queueTimer !== null) {
            clearTimeout(queueTimer);
            queueTimer = null;
        }
        if (Object.keys(queue).length > 0) {
            setTimeout(processQueue, 50);
        }
    }

    function processSerie(ID_Serie) {
        //console.debug("Re counting! ", ID_Serie);
        var query = "select ID_Season, watched, count(watched) as amount from Episodes where ID_Serie = ? AND seasonnumber > 0 AND firstaired <= ? AND firstaired > 0 GROUP BY ID_Season, watched";
        CRUD.EntityManager.getAdapter().db.execute(query, [ID_Serie, new Date().getTime()])
            .then(parseEpisodeCounts)
            .then(markSeasonsWatched)
            .then(function(result) {
                markSerieWatched(ID_Serie, result)
            });
    }


    return {
        recountSerie: function(ID_Serie) {
            if (!(ID_Serie in queue)) {
                queue[ID_Serie] = true;
            }
            processQueue();
        }
    }


})


DuckieTV.run(function($rootScope, FavoritesService, watchedCounter) {

    /**
     * Catch the event when an episode is marked as watched
     */
    $rootScope.$on('episode:marked:watched', function(evt, episode) {
        watchedCounter.recountSerie(episode.ID_Serie);
    });
    /**
     * Catch the event when an episode is marked as NOT watched
     */
    $rootScope.$on('episode:marked:notwatched', function(evt, episode) {
        watchedCounter.recountSerie(episode.ID_Serie);
    });
    /**
     * Catch serie update events
     */
    $rootScope.$on('serie:recount:watched', function(evt, serie) {
        watchedCounter.recountSerie(serie);
    });

    /**
     * Catch global recount event (for migrations 'n stuff )
     */
    $rootScope.$on('series:recount:watched', function(evt) {
        angular.forEach(FavoritesService.favorites, function(serie) {
            watchedCounter.recountSerie(serie.ID_Serie);
        });
    });

})