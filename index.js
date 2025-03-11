// Load SRTM DEM dataset with improved shading
var dem = ee.Image('USGS/SRTMGL1_003');
var demVis = {
  min: 0, max: 3000,
  palette: [
    '#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8',
    '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'
  ]
};

// Global variable to store the drawn polygon
var polygon = null;

// Create UI elements for date selection
var startDateLabel = ui.Label('Select Start Date:');
var startDateInput = ui.Textbox({ placeholder: 'YYYY-MM-DD', value: '2023-01-01' });

var endDateLabel = ui.Label('Select End Date:');
var endDateInput = ui.Textbox({ placeholder: 'YYYY-MM-DD', value: '2023-01-02' });

var updateButton = ui.Button({ label: 'Update Wind Data', onClick: updateWindLayer });

// Function to update wind layer based on selected dates and polygon selection
function updateWindLayer() {
  var startDate = ee.Date(startDateInput.getValue());
  var endDate = ee.Date(endDateInput.getValue());

  var wind = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY')
    .filterDate(startDate, endDate)
    .select(['u_component_of_wind_10m', 'v_component_of_wind_10m'])
    .mean();

  var windDirection = wind.expression(
    'atan2(u, v) * (180 / 3.1415)', {
      'u': wind.select('u_component_of_wind_10m'),
      'v': wind.select('v_component_of_wind_10m')
  }).rename('wind_direction');

  var windVis = {
    min: 0, max: 360,
    palette: ['#440154', '#3b528b', '#21908d', '#5dc963', '#fde725']
  };

  // Clear previous layers
  Map.layers().reset();

  // Apply only within the drawn polygon
  if (polygon) {
    // Important: Convert geometry to ee.Geometry
    var eePolygon = ee.Geometry(polygon);
    
    var clippedDEM = dem.clip(eePolygon);
    var clippedWindDirection = windDirection.clip(eePolygon);
    
    Map.addLayer(clippedDEM, demVis, 'Elevation (DEM)');
    Map.addLayer(clippedWindDirection, windVis, 'Wind Direction', true, 0.5);
    
    // Center map on the polygon
    Map.centerObject(eePolygon);
  } else {
    // If no polygon is drawn, display the global layers
    Map.addLayer(dem, demVis, 'Elevation (DEM)');
    Map.addLayer(windDirection, windVis, 'Wind Direction', true, 0.5);
  }
}

// UI Panel for user input
var controlPanel = ui.Panel({
  widgets: [startDateLabel, startDateInput, endDateLabel, endDateInput, updateButton],
  style: {position: 'top-left', padding: '8px'}
});

Map.add(controlPanel);

// Clear any existing drawing tools
Map.drawingTools().clear();

// Polygon drawing tool
var drawingTools = Map.drawingTools();
drawingTools.setShape('polygon');

// Handle polygon drawing
drawingTools.onDraw(function(geometry) {
  // Clear previous drawings
  drawingTools.layers().reset();
  drawingTools.addLayer([]);
  
  // Set the global polygon variable
  polygon = geometry;
  
  // Update the visualization
  updateWindLayer();
});

// Handle polygon edits
drawingTools.onEdit(function(geometry) {
  polygon = geometry;
  updateWindLayer();
});

// Create a legend panel
var legend = ui.Panel({ style: {position: 'bottom-left', padding: '8px 15px'} });

// Title
var legendTitle = ui.Label({
  value: 'Legend: Elevation & Wind Direction',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', padding: '0'}
});

// Elevation scale with refined gradient
var elevationLabel = ui.Label('Elevation (m)');
var elevationGradient = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select(0).multiply(3000/100).toInt(),
  params: {
    min: 0, max: 3000,
    palette: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', 
              '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    dimensions: '100x10'
  },
  style: {stretch: 'horizontal', margin: '0 0 4px 0'}
});

// Wind direction scale with improved readability
var windLabel = ui.Label('Wind Direction (°)');
var windGradient = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select(0).multiply(360/100).toInt(),
  params: {
    min: 0, max: 360,
    palette: ['#440154', '#3b528b', '#21908d', '#5dc963', '#fde725'],
    dimensions: '100x10'
  },
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

// Center the map initially
Map.setCenter(-100, 40, 5);

// Initial display (before polygon is drawn)
Map.addLayer(dem, demVis, 'Elevation (DEM)');