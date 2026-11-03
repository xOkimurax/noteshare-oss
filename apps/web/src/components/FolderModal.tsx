import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { X, FolderPlus, Loader2 } from 'lucide-react';
import { useFolderMutations } from '../hooks/data';
import { useBackable } from '../hooks/useBackable';

interface FolderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FolderModal({ isOpen, onClose }: FolderModalProps) {
  const { t } = useTranslation();
  const [newFolderName, setNewFolderName] = useState('');
  const { create } = useFolderMutations();
  const isSaving = create.isPending;
  useBackable(isOpen, onClose);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    try {
      await create.mutateAsync(newFolderName.trim());
      setNewFolderName('');
      onClose();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-stone-100 dark:border-stone-800 flex justify-between items-center bg-stone-50/50 dark:bg-stone-900/50">
          <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
            <FolderPlus className="w-6 h-6 text-emerald-600" />
            {t('new_folder') || 'Nueva carpeta'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-200 dark:hover:bg-stone-800 rounded-full transition-all">
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <input 
            type="text" 
            placeholder={t('new_folder') || 'Nueva carpeta'}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-full bg-stone-100 dark:bg-stone-800 border-none rounded-xl p-3 outline-none focus:ring-2 focus:ring-emerald-500 dark:text-white text-sm"
            autoFocus
          />
          
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 btn-secondary">{t('cancel')}</button>
            <button 
              onClick={handleCreate}
              disabled={isSaving || !newFolderName.trim()}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50 flex items-center justify-center transition-colors py-2 font-bold"
            >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : t('save')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
