"""
tests/test_raster_alignment.py - Pruebas sintéticas offline para verificación de alineación de píxeles y procesamiento ráster
"""

import pytest
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.crs import CRS
import tempfile
import os
from shapely.geometry import Polygon, Point
from backend.main import (
    process_cog_raster_ndvi_cropped,
    calculate_change_detection,
    calculate_shapely_area,
    ChangeDetectionRequest,
    GeoJSONGeometry
)

def create_synthetic_geotiff(filepath, array, crs_epsg=32721, transform=None, nodata=0):
    """Crea un GeoTIFF sintético para pruebas offline sin depender de Internet"""
    if transform is None:
        # Default origin en UTM Zone 21S (Corrientes/Misiones, Argentina)
        transform = from_origin(500000, 7000000, 10, 10)

    height, width = array.shape
    with rasterio.open(
        filepath,
        'w',
        driver='GTiff',
        height=height,
        width=width,
        count=1,
        dtype=array.dtype,
        crs=CRS.from_epsg(crs_epsg),
        transform=transform,
        nodata=nodata
    ) as dst:
        dst.write(array, 1)

def test_aligned_rasters():
    """Prueba 1: Rasters RED y NIR perfectamente alineados"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")

        red_arr = np.full((10, 10), 1000, dtype=np.uint16)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)

        create_synthetic_geotiff(red_path, red_arr)
        create_synthetic_geotiff(nir_path, nir_arr)

        geom_wgs84 = Polygon([
            (-56.9999, -27.1225),
            (-56.9991, -27.1225),
            (-56.9991, -27.1233),
            (-56.9999, -27.1233),
            (-56.9999, -27.1225)
        ])

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, None, geom_wgs84)
        assert err is None, f"Error inesperado: {err}"
        assert stats is not None
        assert stats["mean"] == 0.5
        assert stats["min"] == 0.5
        assert stats["max"] == 0.5
        assert stats["sampleCount"] > 0

def test_equal_shape_different_affine_transforms():
    """Prueba 2: Rasters con igual dimensión (10x10) pero transformaciones espaciales distintas (desplazadas)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")

        # RED origen (500000, 7000000)
        transform_red = from_origin(500000, 7000000, 10, 10)
        red_arr = np.full((10, 10), 1000, dtype=np.uint16)
        create_synthetic_geotiff(red_path, red_arr, crs_epsg=32721, transform=transform_red)

        # NIR mismo tamaño (10, 10) pero desplazado 20m al Este (origen 500020, 7000000)
        transform_nir = from_origin(500020, 7000000, 10, 10)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)
        create_synthetic_geotiff(nir_path, nir_arr, crs_epsg=32721, transform=transform_nir)

        geom_wgs84 = Polygon([
            (-56.9999, -27.1225),
            (-56.9991, -27.1225),
            (-56.9991, -27.1233),
            (-56.9999, -27.1233),
            (-56.9999, -27.1225)
        ])

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, None, geom_wgs84)
        assert err is None, f"Error inesperado: {err}"
        assert stats is not None
        assert stats["mean"] == 0.5

def test_point_query_different_crss():
    """Prueba 3: Consulta puntual donde RED está en UTM Zone 21S y NIR en WGS84"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")

        # RED en UTM Zone 21S
        transform_red = from_origin(500000, 7000000, 10, 10)
        red_arr = np.full((10, 10), 1000, dtype=np.uint16)
        create_synthetic_geotiff(red_path, red_arr, crs_epsg=32721, transform=transform_red)

        # NIR en WGS84 (EPSG:4326)
        transform_nir = from_origin(-57.0, -27.122, 0.0001, 0.0001)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)
        create_synthetic_geotiff(nir_path, nir_arr, crs_epsg=4326, transform=transform_nir)

        pt_wgs84 = Point(-56.9995, -27.1226)

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, None, pt_wgs84)
        assert err is None, f"Error inesperado: {err}"
        assert stats is not None
        assert stats["isPoint"] is True
        assert stats["mean"] == 0.5

def test_roi_precision_and_valid_pixel_percent():
    """Prueba 4: Porcentaje de píxeles válidos calculado respecto al número real de píxeles dentro del ROI"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")

        # Matriz grande 20x20
        transform_10m = from_origin(500000, 7000000, 10, 10)
        red_arr = np.full((20, 20), 1000, dtype=np.uint16)
        nir_arr = np.full((20, 20), 3000, dtype=np.uint16)
        create_synthetic_geotiff(red_path, red_arr, transform=transform_10m)
        create_synthetic_geotiff(nir_path, nir_arr, transform=transform_10m)

        # Polígono pequeño en la esquina superior izquierda (4 píxeles reales)
        geom_wgs84 = Polygon([
            (-56.9999, -27.1225),
            (-56.9997, -27.1225),
            (-56.9997, -27.1227),
            (-56.9999, -27.1227),
            (-56.9999, -27.1225)
        ])

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, None, geom_wgs84)
        assert err is None
        assert stats is not None
        assert stats["roiPixelCount"] > 0
        assert stats["validPixelsPercent"] == 100.0

def test_scl_reading_failure_reporting():
    """Prueba 5: Notificación explícita de falla al cargar/alinear SCL en lugar de continuar silenciosamente"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")
        invalid_scl_path = os.path.join(tmpdir, "non_existent_scl.tif")

        create_synthetic_geotiff(red_path, np.full((10, 10), 1000, dtype=np.uint16))
        create_synthetic_geotiff(nir_path, np.full((10, 10), 3000, dtype=np.uint16))

        geom_wgs84 = Polygon([
            (-56.9999, -27.1225),
            (-56.9991, -27.1225),
            (-56.9991, -27.1233),
            (-56.9999, -27.1233),
            (-56.9999, -27.1225)
        ])

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, invalid_scl_path, geom_wgs84)
        assert err is None
        assert stats is not None
        assert stats["sclFilterApplied"] is False
        assert stats["sclWarning"] is not None
        assert "No se pudo cargar o alinear" in stats["sclWarning"]

def test_geodesic_area_calculation():
    """Prueba 6: Cálculo de superficie geodésica exacta sobre WGS84 para distintas latitudes"""
    # Polígono de 1 grado x 1 grado cerca de Buenos Aires (-34 lat) vs Jujuy (-23 lat)
    square_ba = Polygon([
        (-58.5, -34.5),
        (-57.5, -34.5),
        (-57.5, -33.5),
        (-58.5, -33.5),
        (-58.5, -34.5)
    ])

    square_jujuy = Polygon([
        (-65.5, -23.5),
        (-64.5, -23.5),
        (-64.5, -22.5),
        (-65.5, -22.5),
        (-65.5, -23.5)
    ])

    area_ba_m2 = calculate_shapely_area(square_ba)
    area_jujuy_m2 = calculate_shapely_area(square_jujuy)

    # Las superficies geodésicas deben ser coherentes y reflejar convergencia meridiana a mayor latitud
    assert area_ba_m2 > 0
    assert area_jujuy_m2 > 0
    assert area_jujuy_m2 > area_ba_m2 # A menor latitud (más cerca del ecuador), el cuadrado de 1° abarca mayor área m2
    assert calculate_shapely_area(Point(-58.0, -34.0)) == 0.0

def test_nodata_and_cloud_coverage_error():
    """Prueba 7: Error explícito cuando 100% de la superficie es nube/nodata"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")
        scl_path = os.path.join(tmpdir, "scl.tif")

        red_arr = np.full((10, 10), 1000, dtype=np.uint16)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)
        scl_arr = np.full((10, 10), 9, dtype=np.uint8) # 100% nube alta probabilidad

        create_synthetic_geotiff(red_path, red_arr)
        create_synthetic_geotiff(nir_path, nir_arr)
        create_synthetic_geotiff(scl_path, scl_arr)

        geom_wgs84 = Polygon([
            (-56.9999, -27.1225),
            (-56.9991, -27.1225),
            (-56.9991, -27.1233),
            (-56.9999, -27.1233),
            (-56.9999, -27.1225)
        ])

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, scl_path, geom_wgs84)
        assert stats is None
        assert "No se obtuvieron píxeles válidos" in err
