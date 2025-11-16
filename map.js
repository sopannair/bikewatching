// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoic29wYW5uYWlyIiwiYSI6ImNtaHp4MXY0YzBlMHIyam16dHY0bDdjM3oifQ.HkB_T3u53W4EGoOriuw1tw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, trips) {
    const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
    );

    const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
    );

    stations.forEach((station) => {
    const id = station.short_name;
    station.arrivals     = arrivals.get(id) ?? 0;
    station.departures   = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    });
}

map.on('load', async () => {
  // 1. Boston bike network source
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  // 2. Cambridge bike network source
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  // 3. Boston layer
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6
    },
  });

  // 4. Cambridge layer
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#00A7FF', // style Cambridge differently
      'line-width': 4,
      'line-opacity': 0.7
    },
  });
  let jsonData;
  
    try {
    // --- Load stations & trips ---
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const csvurl  = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    const jsonData = await d3.json(jsonurl);
    let trips = await d3.csv(csvurl, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });

    let stations = jsonData.data.stations;

    // --- Helpers for time filtering ---
    function minutesSinceMidnight(date) {
      return date.getHours() * 60 + date.getMinutes();
    }

    function filterTripsByTime(trips, timeFilter) {
      if (timeFilter === -1) return trips; // no filtering

      return trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes   = minutesSinceMidnight(trip.ended_at);

        // within ±60 minutes of selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
    }

    // --- Initial traffic using ALL trips ---
    computeStationTraffic(stations, trips);

    // --- Radius scale ---
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    const svg = d3.select('#map').select('svg');

    // --- Draw circles once ---
    const circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.short_name)
      .enter()
      .append('circle')
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .style('pointer-events', 'auto') // keep tooltips working
      .each(function (d) {
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
          );
      });

    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // --- Slider elements (NOTE: no # in getElementById, and IDs must match HTML) ---
    const timeSlider    = document.getElementById('time-filter');
    const selectedTime  = document.getElementById('time-display');
    const anyTimeLabel  = document.getElementById('time-any');

    function updateTimeDisplayAndFilter() {
      const timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
        radiusScale.range([0, 25]); // default range
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
        radiusScale.range([3, 50]); // emphasize filtered state
      }

      // Filter trips and recompute per-station traffic
      const filteredTrips = filterTripsByTime(trips, timeFilter);
      computeStationTraffic(stations, filteredTrips);

      // Update radii and tooltip text
      circles
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .each(function (d) {
          d3.select(this)
            .select('title')
            .text(
              `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
            );
        });
    }

    // Wire up slider
    if (timeSlider) {
      timeSlider.addEventListener('input', updateTimeDisplayAndFilter);
      updateTimeDisplayAndFilter(); // initial render
    } else {
      console.warn('Time slider element not found');
    }

  } catch (error) {
    console.error('Error loading station or traffic data:', error);
  }
})
// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);