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

// Create the results panel (initially hidden)
var resultsPanel = ui.Panel({
    style: {
        position: 'bottom-right',
        width: '300px',
        padding: '8px'
    }
});
resultsPanel.style().set('shown', false);

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

        // Visualization for the highlighted perpendicular features
        var highlightVis = {
            min: 0,
            max: 20,
            palette: ['black', 'white']
        };

        // Add layers to the map
        Map.addLayer(clippedDEM, demVis, 'Elevation (DEM)');
        Map.addLayer(clippedWindDirection, windVis, 'Wind Direction', false, 0.5);
        Map.addLayer(highlighted, highlightVis, 'Elevation Perpendicular to Wind', true, 0.7);

        // NEW CODE: Extract perpendicular points using the 0.7 threshold
        // Create a mask for areas where the alignment is above the threshold (0.7)
        var thresholdValue = 0.7;
        var perpendicularMask = highlighted.gt(thresholdValue);

        // Sample points from the perpendicular areas
        var samplingScale = 500; // Adjust based on your area size and desired resolution
        var maxPoints = 1000; // Limit the number of points to avoid excessive processing

        // Create a sample feature collection with lat/lon information
        var perpPoints = perpendicularMask.selfMask().sample({
            region: eePolygon,
            scale: samplingScale,
            numPixels: maxPoints,
            geometries: true // Keep geometries to get lat/lon
        });

        // Get the coordinate values for each point
        var pointsWithCoords = perpPoints.map(function (feature)
        {
            var coords = feature.geometry().coordinates();
            // Fixed: using format() instead of round() with precision argument
            return feature.set({
                'longitude': ee.Number(coords.get(0)).format('%.4f'),
                'latitude': ee.Number(coords.get(1)).format('%.4f'),
                'alignment_value': feature.get('wind_direction')
            });
        });

        // Add points to the map
        Map.addLayer(pointsWithCoords, { color: 'red' }, 'Perpendicular Points', false);

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

            // Add explanation
            resultsPanel.add(ui.Label({
                value: 'White areas show elevation features perpendicular to the prevailing wind direction.',
                style: { margin: '10px 0 5px 0', fontSize: '12px' }
            }));

            // Add button to export perpendicular points table
            var exportButton = ui.Button({
                label: 'Show Points Table',
                onClick: function ()
                {
                    showPointsTable(pointsWithCoords);
                }
            });
            resultsPanel.add(exportButton);
        });

    } else
    {
        // If no polygon is drawn, display the global DEM layer
        Map.addLayer(dem, demVis, 'Elevation (DEM)');

        // Hide the results panel
        resultsPanel.style().set('shown', false);
    }
}

// Function to show the table of perpendicular points
function showPointsTable(pointsCollection)
{
    // Create a new panel for the table
    var tablePanel = ui.Panel({
        style: {
            position: 'top-right',
            width: '400px',
            height: '500px',
            padding: '8px'
        }
    });

    // Add title
    tablePanel.add(ui.Label({
        value: 'Perpendicular Points (Threshold > 0.7)',
        style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 10px 0' }
    }));

    // Create a table header
    var headerPanel = ui.Panel({
        widgets: [
            ui.Label('Longitude', { width: '100px', fontWeight: 'bold' }),
            ui.Label('Latitude', { width: '100px', fontWeight: 'bold' })
        ],
        layout: ui.Panel.Layout.flow('horizontal')
    });
    tablePanel.add(headerPanel);

    // Get the points data to display in the table
    pointsCollection = pointsCollection.limit(100); // Limit to first 100 points for UI performance

    // Add a separator
    tablePanel.add(ui.Label('', { border: '1px solid #cccccc', width: '380px' }));

    // Create scrollable container for the table rows
    // Fixed: Removed 'overflow' property and use a fixed height panel instead
    var scrollPanel = ui.Panel({
        style: {
            height: '400px',
            width: '100%',
            padding: '0'
        }
    });
    tablePanel.add(scrollPanel);

    // Evaluate the feature collection to get the points
    pointsCollection.evaluate(function (pointsData)
    {
        // Check if we have points
        if (pointsData && pointsData.features && pointsData.features.length > 0)
        {
            // Add rows to the table (limited to 30 rows to avoid UI performance issues)
            var displayLimit = Math.min(pointsData.features.length, 30);

            for (var i = 0; i < displayLimit; i++)
            {
                var props = pointsData.features[i].properties;
                var row = ui.Panel({
                    widgets: [
                        ui.Label(String(props.longitude), { width: '100px' }),
                        ui.Label(String(props.latitude), { width: '100px' })
                    ],
                    layout: ui.Panel.Layout.flow('horizontal')
                });
                scrollPanel.add(row);
            }

            // Add count information
            scrollPanel.add(ui.Label('Showing ' + displayLimit + ' of ' + pointsData.features.length + ' points',
                { margin: '10px 0', fontStyle: 'italic' }));
        } else
        {
            scrollPanel.add(ui.Label('No points found above the threshold.'));
        }

        // Add export button
        var exportToCSVButton = ui.Button({
            label: 'Export All Points to CSV',
            onClick: function ()
            {
                // Configure the export task
                Export.table.toDrive({
                    collection: pointsCollection,
                    description: 'Perpendicular_Points_Export',
                    fileFormat: 'CSV',
                    selectors: ['longitude', 'latitude']
                });

                // Notify the user
                print('Export task created. Go to the Tasks tab to start the export.');
            }
        });

        tablePanel.add(exportToCSVButton);
    });

    // Add close button
    var closeButton = ui.Button({
        label: 'Close',
        onClick: function ()
        {
            Map.remove(tablePanel);
        },
        style: { margin: '10px 0 0 0' }
    });
    tablePanel.add(closeButton);

    // Add the table panel to the map
    Map.add(tablePanel);
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
Map.setCenter(-100, 40, 5);

// Initial display (before polygon is drawn)
Map.addLayer(dem, demVis, 'Elevation (DEM)');

// Instructions
print('Draw a polygon on the map to analyze elevation features perpendicular to wind direction.');