import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/services/firebase_service.dart';
import '../models/deck_model.dart';

final selectedTagProvider = StateProvider<String?>((ref) => null);
final deckSearchQueryProvider = StateProvider<String>((ref) => '');

final globalDecksProvider = FutureProvider.autoDispose<List<DeckModel>>((ref) async {
  try {
    final snap = await FirebaseService.firestore
        .collection('question_sets')
        .where('is_global', isEqualTo: true)
        .get();

    final decks = snap.docs
        .map((doc) => DeckModel.fromFirestore(doc.id, doc.data()))
        .toList();

    return decks;
  } catch (e) {
    return [];
  }
});

final filteredDecksProvider = Provider.autoDispose<List<DeckModel>>((ref) {
  final decksAsync = ref.watch(globalDecksProvider);
  final selectedTag = ref.watch(selectedTagProvider);
  final query = ref.watch(deckSearchQueryProvider).toLowerCase().trim();

  return decksAsync.maybeWhen(
    data: (decks) {
      return decks.where((deck) {
        if (selectedTag != null && !deck.tags.contains(selectedTag)) {
          return false;
        }
        if (query.isNotEmpty && !deck.title.toLowerCase().contains(query)) {
          return false;
        }
        return true;
      }).toList();
    },
    orElse: () => [],
  );
});

final availableTagsProvider = Provider.autoDispose<List<String>>((ref) {
  final decksAsync = ref.watch(globalDecksProvider);
  return decksAsync.maybeWhen(
    data: (decks) {
      final tagsSet = <String>{};
      for (final d in decks) {
        tagsSet.addAll(d.tags);
      }
      return tagsSet.toList();
    },
    orElse: () => [],
  );
});
