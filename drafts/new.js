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

var globalPerpendicularAreas = null;
var globalPolygon = null;

// Create UI elements for date selection
var startDateLabel = ui.Label('Select Start Date:');
var startDateInput = ui.Textbox({ placeholder: 'YYYY-MM-DD', value: '2023-01-01' });

var endDateLabel = ui.Label('Select End Date:');
var endDateInput = ui.Textbox({ placeholder: 'YYYY-MM-DD', value: '2023-01-02' });

// Add threshold input for alignment
var thresholdLabel = ui.Label('Perpendicular Threshold (0-1):');
var thresholdInput = ui.Textbox({ placeholder: '0-1', value: '0.3' });

var updateButton = ui.Button({ label: 'Update Wind Data', onClick: updateWindLayer });
var extractButton = ui.Button({ label: 'Extract Coordinates', onClick: extractCoordinates });

// Create the results panel (initially hidden)
var resultsPanel = ui.Panel({
    style: {
        position: 'bottom-right',
        width: '300px',
        padding: '8px'
    }
});
resultsPanel.style().set('shown', false);

// Create a panel for the coordinate table
var tablePanel = ui.Panel({
    style: {
        position: 'top-right',
        width: '400px',
        height: '500px',
        padding: '8px'
    }
});
tablePanel.style().set('shown', false);

// Function to update wind layer based on selected dates and polygon selection
function updateWindLayer()
{
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
    if (polygon)
    {
        // Convert geometry to ee.Geometry
        var eePolygon = ee.Geometry(polygon);

        // Clip the DEM and wind direction to the polygon
        var clippedDEM = dem.clip(eePolygon);
        var clippedWindDirection = windDirection.clip(eePolygon);

        // Calculate average wind direction within the polygon
        var meanWindDirection = clippedWindDirection.reduceRegion({
            reducer: ee.Reducer.mean(),
            geometry: eePolygon,
            scale: 1000,
            maxPixels: 1e9
        }).get('wind_direction');

        // Use an ee.Number to ensure proper computation
        meanWindDirection = ee.Number(meanWindDirection);

        // Calculate perpendicular direction to the wind (wind direction + 90°)
        var perpWindDirection = meanWindDirection.add(90).mod(360);

        // Calculate elevation gradient
        var slope = ee.Terrain.slope(clippedDEM);
        var aspect = ee.Terrain.aspect(clippedDEM);

        // Convert aspect to radians for calculation
        var aspectRad = aspect.multiply(Math.PI / 180);

        // Convert perpendicular wind direction to radians
        var perpWindRad = perpWindDirection.multiply(Math.PI / 180);

        // Calculate alignment of aspect with perpendicular wind direction
        // cos(aspect - perpWindDirection) gives high values when they align
        var alignment = aspectRad.subtract(perpWindRad).cos();

        // Multiply by slope to highlight steeper areas
        var highlighted = alignment.multiply(slope).abs();

        // Create a mask for areas that meet the threshold
        var threshold = parseFloat(thresholdInput.getValue());
        var thresholdMask = highlighted.gt(threshold);

        // Apply the mask to the highlighted areas
        var thresholdedAreas = highlighted.updateMask(thresholdMask);

        // Store the masked areas for coordinate extraction
        // Adding latitude and longitude bands for later extraction
        var withCoords = thresholdedAreas.addBands(ee.Image.pixelLonLat());

        // Set as a global property for use in extractCoordinates function
        globalPerpendicularAreas = withCoords;
        globalPolygon = eePolygon;

        // Visualization for the highlighted perpendicular features
        var highlightVis = {
            min: 0,
            max: 20,
            palette: ['black', 'white']
        };

        // Add layers to the map
        Map.addLayer(clippedDEM, demVis, 'Elevation (DEM)');
        Map.addLayer(clippedWindDirection, windVis, 'Wind Direction', false, 0.5);
        Map.addLayer(thresholdedAreas, highlightVis, 'Elevation Perpendicular to Wind (Thresholded)', true, 0.7);

        // Center map on the polygon
        Map.centerObject(eePolygon);

        // Update and show the results panel
        resultsPanel.clear();
        resultsPanel.style().set('shown', true);

        resultsPanel.add(ui.Label({
            value: 'Analysis Results',
            style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 10px 0' }
        }));

        // Add mean wind direction to panel
        meanWindDirection.evaluate(function (windDir)
        {
            resultsPanel.add(ui.Label('Mean Wind Direction: ' + Math.round(windDir) + '°'));
            resultsPanel.add(ui.Label('Perpendicular Direction: ' + (Math.round(windDir) + 90) % 360 + '°'));
            resultsPanel.add(ui.Label('Applied Threshold: ' + threshold));

            // Add explanation
            resultsPanel.add(ui.Label({
                value: 'White areas show elevation features perpendicular to the prevailing wind direction that exceed the threshold.',
                style: { margin: '10px 0 5px 0', fontSize: '12px' }
            }));

            // Add extract coordinates button to results panel
            resultsPanel.add(extractButton);
        });

    } else
    {
        // If no polygon is drawn, display the global DEM layer
        Map.addLayer(dem, demVis, 'Elevation (DEM)');

        // Hide the results panel
        resultsPanel.style().set('shown', false);
        tablePanel.style().set('shown', false);
    }
}

// Function to extract coordinates of areas perpendicular to wind direction
function extractCoordinates()
{
    if (!globalPerpendicularAreas || !globalPolygon)
    {
        print('Please run the analysis first by clicking "Update Wind Data"');
        return;
    }

    // Display loading message
    tablePanel.clear();
    tablePanel.style().set('shown', true);
    tablePanel.add(ui.Label('Extracting coordinates... This may take a moment.'));

    // Sample points from the thresholded areas
    var sampledPoints = globalPerpendicularAreas.sample({
        region: globalPolygon,
        scale: 90, // SRTM resolution
        geometries: true
    });

    // Convert to a feature collection with longitude and latitude properties
    var pointsWithCoords = sampledPoints.map(function (feature)
    {
        var geom = feature.geometry();
        var lon = ee.Number(geom.coordinates().get(0)).float();
        var lat = ee.Number(geom.coordinates().get(1)).float();
        var alignmentValue = ee.Number(feature.get('constant')).float();

        return ee.Feature(geom, {
            'longitude': lon,
            'latitude': lat,
            'alignment_value': alignmentValue
        });
    });

    // Sort by alignment value (strongest perpendicular features first)
    var sortedPoints = pointsWithCoords.sort('alignment_value', false);

    // Get the size of the collection
    sortedPoints.size().evaluate(function (size)
    {
        if (!size || size === 0)
        {
            tablePanel.clear();
            tablePanel.add(ui.Label('No points found that meet the threshold criteria.'));
            return;
        }

        // Limit to 5000 points to avoid memory issues (adjust as needed)
        var maxPoints = ee.Number(Math.min(size, 5000));
        var limitedPoints = sortedPoints.limit(maxPoints);

        // Get the point data
        limitedPoints.toList(maxPoints).evaluate(function (pointList) 
        {
            // Clear the panel and create the table
            tablePanel.clear();

            // Add header
            tablePanel.add(ui.Label({
                value: 'Areas Perpendicular to Wind Direction',
                style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 10px 0' }
            }));

            tablePanel.add(ui.Label('Total points found: ' + size + ' (showing up to ' + maxPoints + ')'));

            // Create a panel for the table with scrolling
            var scrollPanel = ui.Panel({
                style: {
                    height: '400px',
                    width: '380px',
                    padding: '0px',
                    overflow: 'auto'
                }
            });

            // Add table headers
            var headerPanel = ui.Panel({
                widgets: [
                    ui.Label('Longitude', { width: '120px', fontWeight: 'bold' }),
                    ui.Label('Latitude', { width: '120px', fontWeight: 'bold' }),
                    ui.Label('Alignment', { width: '120px', fontWeight: 'bold' })
                ],
                layout: ui.Panel.Layout.flow('horizontal')
            });
            scrollPanel.add(headerPanel);

            // Add data rows
            for (var i = 0; i < pointList.length; i++)
            {
                var point = pointList[i];
                var rowPanel = ui.Panel({
                    widgets: [
                        ui.Label(point.properties.longitude.toFixed(6), { width: '120px' }),
                        ui.Label(point.properties.latitude.toFixed(6), { width: '120px' }),
                        ui.Label(point.properties.alignment_value.toFixed(4), { width: '120px' })
                    ],
                    layout: ui.Panel.Layout.flow('horizontal')
                });
                scrollPanel.add(rowPanel);
            }

            // Add an export button
            var exportButton = ui.Button({
                label: 'Export to CSV',
                onClick: function ()
                {
                    // Prepare the export
                    Export.table.toDrive({
                        collection: limitedPoints,
                        description: 'Wind_Perpendicular_Areas',
                        fileFormat: 'CSV'
                    });
                    print('Export task created. Check the Tasks tab to start the export.');
                }
            });

            // Add the scroll panel and export button to the main panel
            tablePanel.add(scrollPanel);
            tablePanel.add(exportButton);
        });
    });
}

// UI Panel for user input
var controlPanel = ui.Panel({
    widgets: [
        ui.Label({
            value: 'Wind-Perpendicular Elevation Analysis',
            style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 10px 0' }
        }),
        ui.Label('1. Select date range:'),
        startDateLabel,
        startDateInput,
        endDateLabel,
        endDateInput,
        thresholdLabel,
        thresholdInput,
        updateButton,
        ui.Label({
            value: '2. Draw a polygon on the map to analyze',
            style: { margin: '10px 0 5px 0' }
        })
    ],
    style: { position: 'top-left', padding: '8px' }
});

Map.add(controlPanel);
Map.add(resultsPanel);
Map.add(tablePanel);

// Clear any existing drawing tools
Map.drawingTools().clear();

// Polygon drawing tool
var drawingTools = Map.drawingTools();
drawingTools.setShape('polygon');

// Handle polygon drawing
drawingTools.onDraw(function (geometry)
{
    // Clear previous drawings
    drawingTools.layers().remove(drawingTools.layers().get(0));
    drawingTools.addLayer([]);

    // Set the global polygon variable
    polygon = geometry;

    // Update the visualization
    updateWindLayer();
});

// Handle polygon edits
drawingTools.onEdit(function (geometry)
{
    polygon = geometry;
    updateWindLayer();
});

// Create a legend panel
var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });

// Title
var legendTitle = ui.Label({
    value: 'Legend',
    style: { fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0', padding: '0' }
});

// Elevation scale
var elevationLabel = ui.Label('Elevation (m)');
var elevationGradient = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0).multiply(3000 / 100).toInt(),
    params: {
        min: 0, max: 3000,
        palette: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf',
            '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
        dimensions: '100x10'
    },
    style: { stretch: 'horizontal', margin: '0 0 4px 0' }
});

// Perpendicular features scale
var perpLabel = ui.Label('Perpendicular Features');
var perpGradient = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0).multiply(20 / 100).toInt(),
    params: {
        min: 0, max: 20,
        palette: ['black', 'white'],
        dimensions: '100x10'
    },
    style: { stretch: 'horizontal', margin: '0 0 4px 0' }
});

// Add elements to the legend panel
legend.add(legendTitle);
legend.add(elevationLabel);
legend.add(elevationGradient);
legend.add(perpLabel);
legend.add(perpGradient);

// Add legend to the map
Map.add(legend);

// Center the map initially
// Center the map initially
Map.setCenter(122.5, 12.5, 5);

// Initial display (before polygon is drawn)
Map.addLayer(dem, demVis, 'Elevation (DEM)');

// Instructions
print('Draw a polygon on the map to analyze elevation features perpendicular to wind direction.');
print('After analysis, click "Extract Coordinates" to view points perpendicular to wind direction.');
print('You can export results as CSV via the button in the coordinates panel.');