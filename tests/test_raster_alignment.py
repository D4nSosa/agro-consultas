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
from backend.main import process_cog_raster_ndvi_cropped

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

        # Matriz 10x10 de reflectancias (RED=1000, NIR=3000 -> NDVI = (3000-1000)/(3000+1000) = 0.5)
        red_arr = np.full((10, 10), 1000, dtype=np.uint16)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)

        create_synthetic_geotiff(red_path, red_arr)
        create_synthetic_geotiff(nir_path, nir_arr)

        # Polígono GeoJSON WGS84 que cubre la zona exacta del raster sintético UTM (500000, 7000000)
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

def test_different_resolutions_and_crs_reprojection():
    """Prueba 2: Rasters con distinta resolución y CRS (reproyección y remuestreo bilineal)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")

        # RED en EPSG:32721 (UTM 21S) a 10m de resolución
        transform_red = from_origin(500000, 7000000, 10, 10)
        red_arr = np.full((20, 20), 1000, dtype=np.uint16)
        create_synthetic_geotiff(red_path, red_arr, crs_epsg=32721, transform=transform_red)

        # NIR en EPSG:4326 (WGS84 degrees) a ~20m de resolución equivalente
        transform_nir = from_origin(-57.0, -27.122, 0.0002, 0.0002)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)
        create_synthetic_geotiff(nir_path, nir_arr, crs_epsg=4326, transform=transform_nir)

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
        assert 0.4 <= stats["mean"] <= 0.6

def test_categorical_scl_mask_reprojection():
    """Prueba 3: Máscara SCL con grilla diferente (remuestreo Nearest Neighbor)"""
    with tempfile.TemporaryDirectory() as tmpdir:
        red_path = os.path.join(tmpdir, "red.tif")
        nir_path = os.path.join(tmpdir, "nir.tif")
        scl_path = os.path.join(tmpdir, "scl.tif")

        transform_10m = from_origin(500000, 7000000, 10, 10)
        red_arr = np.full((10, 10), 1000, dtype=np.uint16)
        nir_arr = np.full((10, 10), 3000, dtype=np.uint16)
        create_synthetic_geotiff(red_path, red_arr, transform=transform_10m)
        create_synthetic_geotiff(nir_path, nir_arr, transform=transform_10m)

        # SCL a 20m de resolución (matriz 5x5), con la mitad superior cubierta por nube (clase 9)
        transform_20m = from_origin(500000, 7000000, 20, 20)
        scl_arr = np.full((5, 5), 4, dtype=np.uint8) # Clase 4 = vegetación
        scl_arr[:2, :] = 9 # Clase 9 = Nube probabilidad alta
        create_synthetic_geotiff(scl_path, scl_arr, transform=transform_20m, nodata=0)

        geom_wgs84 = Polygon([
            (-56.9999, -27.1225),
            (-56.9991, -27.1225),
            (-56.9991, -27.1233),
            (-56.9999, -27.1233),
            (-56.9999, -27.1225)
        ])

        stats, err = process_cog_raster_ndvi_cropped(red_path, nir_path, scl_path, geom_wgs84)
        assert err is None, f"Error inesperado: {err}"
        assert stats is not None
        # Píxeles sin nube conservan el cálculo NDVI
        assert stats["mean"] == 0.5
        # Muestra menos píxeles por la máscara de nubes
        assert stats["validPixelsPercent"] < 100.0

def test_nodata_and_cloud_coverage_error():
    """Prueba 4: Error explícito cuando 100% de la superficie es nube/nodata"""
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
