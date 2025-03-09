// Load SRTM DEM dataset
var dem = ee.Image('USGS/SRTMGL1_003');
var demVis = {min: 0, max: 3000, palette: ['blue', 'green', 'yellow', 'red']};

// Load ERA5 wind data (u and v wind components)
var wind = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY')
  .filterDate('2023-01-01', '2023-01-02')  // Use one day of data
  .select(['u_component_of_wind_10m', 'v_component_of_wind_10m'])
  .mean();

// Compute wind direction (in degrees)
var windDirection = wind.expression(
  'atan2(u, v) * (180 / 3.1415)', {
    'u': wind.select('u_component_of_wind_10m'),
    'v': wind.select('v_component_of_wind_10m')
}).rename('wind_direction');

// Define visualization for wind direction (color gradient for different directions)
var windVis = {min: 0, max: 360, palette: ['purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red']};

// Overlay both layers
Map.addLayer(dem, demVis, 'Elevation (DEM)');
Map.addLayer(windDirection, windVis, 'Wind Direction', true, 0.5); // 50% transparency

// Center the map
Map.setCenter(-100, 40, 5);

// Create a legend panel
var legend = ui.Panel({
  style: {position: 'bottom-left', padding: '8px 15px'}
});

// Title
var legendTitle = ui.Label({
  value: 'Legend: Elevation & Wind Direction',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', padding: '0'}
});

// Elevation scale
var elevationLabel = ui.Label('Elevation (m)');
var elevationGradient = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select(0).multiply(3000/100).toInt(),
  params: {min: 0, max: 3000, palette: ['blue', 'green', 'yellow', 'red'], dimensions: '100x10'},
  style: {stretch: 'horizontal', margin: '0 0 4px 0'}
});

// Wind direction scale
var windLabel = ui.Label('Wind Direction (°)');
var windGradient = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select(0).multiply(360/100).toInt(),
  params: {min: 0, max: 360, palette: ['purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red'], dimensions: '100x10'},
  style: {stretch: 'horizontal', margin: '0 0 4px 0'}
});

// Add elements to the legend panel
legend.add(legendTitle);
legend.add(elevationLabel);
legend.add(elevationGradient);
legend.add(windLabel);
legend.add(windGradient);

// Add legend to the map
Map.add(legend);

// Description of colors:
// - Elevation: Blue (low altitude), Green (moderate), Yellow (high), Red (very high).
// - Wind Direction: 
//   - Purple (0° - North), Blue (90° - East), Cyan (135° - Southeast),
//   - Green (180° - South), Yellow (225° - Southwest),
//   - Orange (270° - West), Red (360° - North).
