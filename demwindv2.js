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
        var alignment = aspectRad.subtract(perpWindRad).cos().abs();

        // Multiply by slope to highlight steeper areas
        var highlighted = alignment.multiply(slope).abs();

        //------------------------------------------------------------------------------------------------------------
        var alignmentVis = {
            min: 0,
            max: 1,
            palette: ['white', 'black']
        };

        // threshold of alignment is 0.3
        // alignment will give us errorneous result
        //because of the resolutin size from the dataset. 
        var alignment_clean = alignment.updateMask(alignment.lte(0.3));
        var alignment_clean_vis = {
            min: 0,
            max: 0.3,
            palette: ['white', 'black']
        };

        var stats_highlighted = highlighted.reduceRegion({
            reducer: ee.Reducer.min().combine({
                reducer2: ee.Reducer.max(),
                sharedInputs: true
            }),
            geometry: polygon,
            scale: 30, // Resolution in meters
            bestEffort: true // Helps avoid memory issues in complex geometries
        });
        print(stats_highlighted);


        // convert to ee.Number class for arithmitic operations
        var min_highlighted = ee.Number(stats_highlighted.get("aspect_min"));
        var max_highlighted = ee.Number(stats_highlighted.get("aspect_max"));
        var min_highlighted_int = parseInt(stats_highlighted.get("aspect_min"));
        var max_highlighted_int = parseInt(stats_highlighted.get("aspect_max"));


        var mask_rate = ee.Number(0.1);
        var mask_value_limit = max_highlighted.multiply(mask_rate);
        print("limit", mask_value_limit);
        var highlighted_mask = highlighted.updateMask(highlighted.lte(10));


        // var highlighted_mask_vis = {
        //   min: min_highlighted_int,
        //   max: parseInt(mask_value_limit),
        //   palette: ['white', 'black']
        // };

        var highlighted_mask_vis = {
            min: 0,
            max: 5,
            palette: ['white', 'black']
        };

        // var highlighted_mask_vis = {
        //   min: 0,
        //   max: 50,
        //   palette: ['white', 'black']
        // };

        //------------------------------------------------------------------------------------------------------------
        // Visualization for the highlighted perpendicular features
        var highlightVis = {
            min: 0,
            max: 20,
            palette: ['white', 'black']
        };


        // Add layers to the map
        Map.addLayer(clippedDEM, demVis, 'Elevation (DEM)');
        Map.addLayer(clippedWindDirection, windVis, 'Wind Direction', false, 0.5);
        Map.addLayer(highlighted, highlightVis, 'Elevation Perpendicular to Wind', true, 0.7);
        Map.addLayer(alignment, alignmentVis, 'alignment', false, 0.7);
        Map.addLayer(alignment_clean, alignment_clean_vis, 'alignment clean', false, 0.7);
        Map.addLayer(highlighted_mask, highlighted_mask_vis, "highlighted mask below mask value", false, 0.7);


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
        });

    } else
    {
        // If no polygon is drawn, display the global DEM layer
        Map.addLayer(dem, demVis, 'Elevation (DEM)');

        // Hide the results panel
        resultsPanel.style().set('shown', false);
    }
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
Map.setCenter(122.5, 12.5, 5);

// Initial display (before polygon is drawn)
Map.addLayer(dem, demVis, 'Elevation (DEM)');

// Instructions
print('Draw a polygon on the map to analyze elevation features perpendicular to wind direction.');