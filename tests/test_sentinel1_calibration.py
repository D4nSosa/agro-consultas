import numpy as np

from backend.sentinel1_calibration import (
    _calibrate_array,
    parse_calibration_lut,
    parse_noise_lut,
)


CALIBRATION_XML = b"""<calibration>
<calibrationVectorList>
  <calibrationVector><line>0</line><pixel>0 10</pixel><sigmaNought>2 2</sigmaNought></calibrationVector>
  <calibrationVector><line>10</line><pixel>0 10</pixel><sigmaNought>2 2</sigmaNought></calibrationVector>
</calibrationVectorList>
</calibration>"""

NOISE_XML = b"""<noise>
<noiseVectorList>
  <noiseVector><line>0</line><pixel>0 10</pixel><noiseLut>1 1</noiseLut></noiseVector>
  <noiseVector><line>10</line><pixel>0 10</pixel><noiseLut>1 1</noiseLut></noiseVector>
</noiseVectorList>
</noise>"""


def test_parse_esa_calibration_lut_and_interpolate():
    lut = parse_calibration_lut(CALIBRATION_XML)
    assert lut["values"].shape == (2, 2)
    assert np.allclose(lut["values"], 2.0)


def test_parse_legacy_noise_lut_schema():
    noise = parse_noise_lut(NOISE_XML)
    assert noise["values"].shape == (2, 2)
    assert noise["azimuth_blocks"] == []


def test_sigma0_formula_subtracts_noise_power_before_lut_calibration():
    calibration = parse_calibration_lut(CALIBRATION_XML)
    noise = parse_noise_lut(NOISE_XML)
    dn = np.asarray([3.0])
    sigma0, valid = _calibrate_array(
        dn, np.asarray([5.0]), np.asarray([5.0]), calibration, noise
    )
    # (DN^2 - noise) / A_sigma^2 = (9 - 1) / 4 = 2
    assert valid.tolist() == [True]
    assert np.allclose(sigma0, [2.0])


def test_parse_modern_noise_lut_with_azimuth_scaling():
    xml = b"""<noise>
    <noiseRangeVectorList>
      <noiseRangeVector><line>0</line><pixel>0 10</pixel><noiseRangeLut>2 2</noiseRangeLut></noiseRangeVector>
      <noiseRangeVector><line>10</line><pixel>0 10</pixel><noiseRangeLut>2 2</noiseRangeLut></noiseRangeVector>
    </noiseRangeVectorList>
    <noiseAzimuthVectorList>
      <noiseAzimuthVector>
        <firstAzimuthLine>0</firstAzimuthLine><lastAzimuthLine>10</lastAzimuthLine>
        <firstRangeSample>0</firstRangeSample><lastRangeSample>10</lastRangeSample>
        <line>0 10</line><noiseAzimuthLut>3 3</noiseAzimuthLut>
      </noiseAzimuthVector>
    </noiseAzimuthVectorList>
    </noise>"""
    noise = parse_noise_lut(xml)
    result = _calibrate_array(
        np.asarray([4.0]), np.asarray([5.0]), np.asarray([5.0]),
        parse_calibration_lut(CALIBRATION_XML), noise
    )[0]
    # (16 - (2 * 3)) / 2^2 = 2.5
    assert np.allclose(result, [2.5])
