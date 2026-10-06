import unittest
import os
import json

class TestImageAnalysisService(unittest.TestCase):
    def test_exif_extractor_module_exists(self):
        self.assertTrue(os.path.exists("utils/exifExtractor.js"))

    def test_image_analysis_service_exists(self):
        self.assertTrue(os.path.exists("services/imageAnalysisService.js"))

    def test_image_analysis_imports(self):
        with open("services/imageAnalysisService.js", "r", encoding="utf-8") as f:
            code = f.read()
        self.assertIn("analyzeUploadedImages", code)
        self.assertIn("removeImageFromBatch", code)
        self.assertIn("extractExifMetadata", code)

if __name__ == "__main__":
    unittest.main()
