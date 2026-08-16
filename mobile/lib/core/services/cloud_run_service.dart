import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../constants/app_constants.dart';

class CloudRunService {
  static Future<Map<String, dynamic>> processDocument({
    required Uint8List fileBytes,
    required String fileName,
  }) async {
    final uri = Uri.parse('${AppConstants.cloudRunUrl}/process');
    final request = http.MultipartRequest('POST', uri);

    if (AppConstants.cloudRunSecret.isNotEmpty) {
      request.headers['x-api-secret'] = AppConstants.cloudRunSecret;
    }

    request.files.add(
      http.MultipartFile.fromBytes(
        'file',
        fileBytes,
        filename: fileName,
      ),
    );

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      throw Exception('استجابة غير صالحة من المعالج الذكي');
    } else {
      throw Exception('فشل في معالجة الملف: ${response.statusCode}');
    }
  }
}
