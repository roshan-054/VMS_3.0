import React, { useState, useEffect, useMemo } from 'react';
import {
  PackagePlus,
  Boxes,
  Barcode,
  UserCheck,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Sliders,
  Upload,
  Download,
  FileSpreadsheet,
  Clock,
  Filter,
  Check,
  X,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
  ShoppingBag,
  Eye,
  Edit2
} from 'lucide-react';
import { PlatformType, User, OrderManifest, ManifestItem, GtinCatalogProduct, PackVerificationLog } from '../types';
import {
  getStoredManifests,
  saveOrderManifest,
  saveMultipleManifests,
  deleteManifest,
  getStoredGtinCatalog,
  addOrUpdateGtinProduct,
  findProductByGtin,
  findProductInCatalog,
  searchCatalog,
  getGtinSheetConfig,
  saveGtinSheetConfig,
  syncGtinFromGoogleSheet,
  getStoredVerificationLogs,
  extractSpreadsheetId
} from '../lib/manifestStorage';
import { requestApi } from '../lib/api';

interface OrderProcessingProps {
  currentUser: User | null;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const OrderProcessing: React.FC<OrderProcessingProps> = ({
  currentUser,
  onShowToast
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'entry' | 'manifest' | 'gtin' | 'audit'>('entry');
  const [manifests, setManifests] = useState<OrderManifest[]>(() => getStoredManifests());
  const [gtinCatalog, setGtinCatalog] = useState<GtinCatalogProduct[]>(() => getStoredGtinCatalog());
  const [verificationLogs, setVerificationLogs] = useState<PackVerificationLog[]>(() => getStoredVerificationLogs());
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false);

  // --- Order Entry Form State ---
  const [orderId, setOrderId] = useState<string>('');
  const [platform, setPlatform] = useState<PlatformType>('Amazon');
  const [customPlatform, setCustomPlatform] = useState<string>('');
  const [assignedPackerEmail, setAssignedPackerEmail] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Multi-item lines for the current order
  const [orderItems, setOrderItems] = useState<Array<{
    tempId: string;
    sku: string;
    productName: string;
    shortName: string;
    gtin: string;
    quantity: number;
    imageUrl: string;
  }>>([
    {
      tempId: 'item-1',
      sku: '',
      productName: '',
      shortName: '',
      gtin: '',
      quantity: 1,
      imageUrl: ''
    }
  ]);

  // Active suggestions dropdown state for item entry
  const [activeSuggestion, setActiveSuggestion] = useState<{
    rowIndex: number;
    field: 'gtin' | 'sku' | 'productName';
  } | null>(null);

  // --- External GTIN Google Sheet Sync Modal / Settings State ---
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [gtinSheetInput, setGtinSheetInput] = useState<string>(() => getGtinSheetConfig().sheetIdOrUrl);
  const [gtinSheetTab, setGtinSheetTab] = useState<string>(() => getGtinSheetConfig().tabName || 'Sheet1');
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [sheetSyncResult, setSheetSyncResult] = useState<{ success?: boolean; msg?: string } | null>(null);

  // --- Search & Filters for Manifest List ---
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [packerFilter, setPackerFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');

  // --- Add Product to Catalog State ---
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState<boolean>(false);
  const [newGtin, setNewGtin] = useState<string>('');
  const [newSku, setNewSku] = useState<string>('');
  const [newProdName, setNewProdName] = useState<string>('');
  const [newShortName, setNewShortName] = useState<string>('');
  const [newImageUrl, setNewImageUrl] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>('General');

  // Load registered users from API
  useEffect(() => {
    let isMounted = true;
    const loadUsers = async () => {
      setIsLoadingUsers(true);
      try {
        const res = await requestApi<{ users: User[] }>('getUsers', {});
        if (isMounted && res && res.users && Array.isArray(res.users)) {
          setRegisteredUsers(res.users);
          // Auto-select first active packer if not selected
          const activePacker = res.users.find((u) => u.status === 'Approved' && u.email !== currentUser?.email);
          if (activePacker && !assignedPackerEmail) {
            setAssignedPackerEmail(activePacker.email);
          }
        }
      } catch (e) {
        console.warn('Could not fetch users list for packer assignment:', e);
      } finally {
        if (isMounted) setIsLoadingUsers(false);
      }
    };
    loadUsers();

    // Listen to updates from other tabs
    const handleManifestUpdate = () => setManifests(getStoredManifests());
    const handleGtinUpdate = () => setGtinCatalog(getStoredGtinCatalog());
    const handleLogsUpdate = () => setVerificationLogs(getStoredVerificationLogs());

    window.addEventListener('vms_manifests_updated', handleManifestUpdate);
    window.addEventListener('vms_gtin_catalog_updated', handleGtinUpdate);
    window.addEventListener('vms_verification_logs_updated', handleLogsUpdate);

    return () => {
      isMounted = false;
      window.removeEventListener('vms_manifests_updated', handleManifestUpdate);
      window.removeEventListener('vms_gtin_catalog_updated', handleGtinUpdate);
      window.removeEventListener('vms_verification_logs_updated', handleLogsUpdate);
    };
  }, []);

  // Handlers for adding/removing line items in order entry
  const handleAddItemRow = () => {
    setOrderItems((prev) => [
      ...prev,
      {
        tempId: 'item-' + (prev.length + 1) + '-' + Date.now(),
        sku: '',
        productName: '',
        shortName: '',
        gtin: '',
        quantity: 1,
        imageUrl: ''
      }
    ]);
  };

  const handleRemoveItemRow = (index: number) => {
    if (orderItems.length <= 1) return;
    setOrderItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemFieldChange = (index: number, field: string, value: any) => {
    setOrderItems((prev) => {
      const updated = [...prev];
      const target = { ...updated[index], [field]: value };

      // Multi-directional Auto-Fill:
      // If user types or changes Product Name, SKU, or GTIN, look up match in GTIN catalog!
      if (field === 'gtin' || field === 'sku' || field === 'productName' || field === 'shortName') {
        const found = findProductInCatalog(value);
        if (found) {
          // If match found, auto-fill all other fields and image!
          if (found.gtin && (field === 'productName' || field === 'sku' || !target.gtin)) {
            target.gtin = found.gtin;
          }
          if (found.sku && (field === 'productName' || field === 'gtin' || !target.sku)) {
            target.sku = found.sku;
          }
          if (found.productName && field !== 'productName') {
            target.productName = found.productName;
          }
          if (found.shortName && field !== 'shortName') {
            target.shortName = found.shortName;
          }
          if (found.imageUrl) {
            target.imageUrl = found.imageUrl;
          }
        }
      }

      updated[index] = target;
      return updated;
    });
  };

  const handleSelectProductFromCatalog = (index: number, product: GtinCatalogProduct) => {
    setOrderItems((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        gtin: product.gtin || updated[index].gtin || '',
        sku: product.sku || updated[index].sku || '',
        productName: product.productName || updated[index].productName || '',
        shortName: product.shortName || product.productName || updated[index].shortName || '',
        imageUrl: product.imageUrl || updated[index].imageUrl || ''
      };
      return updated;
    });
    setActiveSuggestion(null);
  };

  const handleFieldBlur = (index: number, field: 'gtin' | 'sku' | 'productName') => {
    setTimeout(() => {
      setActiveSuggestion((curr) => (curr?.rowIndex === index && curr?.field === field ? null : curr));
    }, 220);

    // Auto-fill on blur if a matching catalog product is detected
    const currentItem = orderItems[index];
    if (currentItem) {
      const val = field === 'productName' ? currentItem.productName : field === 'sku' ? currentItem.sku : currentItem.gtin;
      if (val && val.trim()) {
        const found = findProductInCatalog(val.trim());
        if (found) {
          handleSelectProductFromCatalog(index, found);
        }
      }
    }
  };

  const handleAutoAssignBarcode = (index: number) => {
    const random10 = Math.floor(1000000000 + Math.random() * 9000000000);
    const generatedGtin = `890${random10}`;
    setOrderItems((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        gtin: generatedGtin,
        sku: updated[index].sku || `SKU-${Date.now().toString().slice(-6)}`
      };
      return updated;
    });
    onShowToast(`Auto-assigned Barcode: ${generatedGtin}`, 'info');
  };

  // Submit Order Manifest Pre-Entry
  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!orderId.trim()) {
      onShowToast('Please enter an Order ID', 'error');
      return;
    }

    if (!assignedPackerEmail) {
      onShowToast('Please select an assigned packer', 'error');
      return;
    }

    // Validate item lines: Product Name, SKU, and GTIN Barcode are ALL COMPULSORY!
    // Entering any one auto-fetches the others, but all three must be present so packer can verify.
    const validItems: ManifestItem[] = [];
    for (let i = 0; i < orderItems.length; i++) {
      const it = orderItems[i];
      if (!it.productName.trim()) {
        onShowToast(`Line ${i + 1}: Product Name is compulsory (enter name or pick from catalog)`, 'error');
        return;
      }
      if (!it.sku.trim()) {
        onShowToast(`Line ${i + 1}: SKU / Item Code is compulsory (enter SKU or auto-fill from name)`, 'error');
        return;
      }
      if (!it.gtin.trim()) {
        onShowToast(`Line ${i + 1}: GTIN / Barcode is compulsory so the packer can scan and verify the item!`, 'error');
        return;
      }
      validItems.push({
        id: 'item-' + (i + 1) + '-' + Date.now(),
        sku: it.sku.trim().toUpperCase(),
        productName: it.productName.trim(),
        shortName: it.shortName.trim() || it.productName.trim(),
        gtin: it.gtin.trim().toUpperCase(),
        quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
        scannedCount: 0,
        imageUrl: it.imageUrl.trim() || undefined
      });

      // Auto-save/preserve this product in the GTIN Catalog for future orders!
      addOrUpdateGtinProduct({
        gtin: it.gtin.trim().toUpperCase(),
        sku: it.sku.trim().toUpperCase(),
        productName: it.productName.trim(),
        shortName: it.shortName.trim() || it.productName.trim(),
        category: 'General',
        imageUrl: it.imageUrl.trim() || undefined
      });
    }

    const assignedPacker = registeredUsers.find((u) => u.email === assignedPackerEmail);
    const assignedName = assignedPacker ? assignedPacker.name : assignedPackerEmail.split('@')[0];

    const effectivePlatform = platform === 'Custom' ? customPlatform.trim() || 'Custom' : platform;

    const newManifest: OrderManifest = {
      id: 'manifest-' + Date.now(),
      orderId: orderId.trim().toUpperCase(),
      platform: effectivePlatform as PlatformType,
      assignedPackerName: assignedName,
      assignedPackerEmail: assignedPackerEmail.trim().toLowerCase(),
      processedByName: currentUser?.name || 'Processing Team',
      processedByEmail: currentUser?.email || 'processing@ops.local',
      processedAt: new Date().toISOString(),
      items: validItems,
      status: 'Pending',
      notes: notes.trim() || undefined
    };

    await saveOrderManifest(newManifest);
    setManifests(getStoredManifests());

    onShowToast(`Order ${newManifest.orderId} assigned to ${assignedName}!`, 'success');

    // Reset Form for next order
    setOrderId('');
    setNotes('');
    setOrderItems([
      {
        tempId: 'item-1',
        sku: '',
        productName: '',
        shortName: '',
        gtin: '',
        quantity: 1,
        imageUrl: ''
      }
    ]);
  };

  // Sync with user's separate GTIN Google Sheet
  const handlePerformGtinSync = async () => {
    if (!gtinSheetInput.trim()) {
      setSheetSyncResult({ success: false, msg: 'Please provide your Google Sheet ID or URL.' });
      return;
    }

    setIsSyncingSheet(true);
    setSheetSyncResult(null);

    const res = await syncGtinFromGoogleSheet(gtinSheetInput.trim(), gtinSheetTab.trim() || 'Sheet1');
    setIsSyncingSheet(false);
    setSheetSyncResult({ success: res.success, msg: res.message });

    if (res.success) {
      setGtinCatalog(getStoredGtinCatalog());
      onShowToast(res.message, 'success');
      setTimeout(() => {
        setIsSyncModalOpen(false);
        setSheetSyncResult(null);
      }, 1800);
    } else {
      onShowToast(res.message, 'error');
    }
  };

  // Add Product to GTIN Catalog
  const handleAddNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGtin.trim()) {
      onShowToast('GTIN / Barcode is required', 'error');
      return;
    }

    const prod: GtinCatalogProduct = {
      gtin: newGtin.trim(),
      sku: newSku.trim() || newGtin.trim(),
      productName: newProdName.trim() || `Product ${newGtin}`,
      shortName: newShortName.trim() || newProdName.trim() || newSku.trim() || newGtin.trim(),
      imageUrl: newImageUrl.trim() || undefined,
      category: newCategory.trim() || 'General'
    };

    await addOrUpdateGtinProduct(prod);
    setGtinCatalog(getStoredGtinCatalog());
    onShowToast(`Product ${prod.shortName} added to GTIN catalog!`, 'success');

    setIsAddProductModalOpen(false);
    setNewGtin('');
    setNewSku('');
    setNewProdName('');
    setNewShortName('');
    setNewImageUrl('');
  };

  const handleDownloadCsvTemplate = () => {
    const csvContent =
      'GTIN,SKU,Product Name,Short Name,Category,Image URL\n' +
      '8901234567890,SKU-SHIRT-NAVY-L,Premium Cotton Oxford Shirt - Navy Blue (Size L),Navy Oxford Shirt (L),Apparel,https://images.unsplash.com/photo-1596755094514-f87e34085b2c\n' +
      '8909876543210,SKU-EARBUDS-PRO,Wireless Active Noise Cancelling Earbuds Pro,ANC Earbuds Pro,Electronics,https://images.unsplash.com/photo-1590658268037-6bf12165a8df\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'GTIN_Products_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = String(evt.target?.result || '');
      if (!text) return;

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) {
        onShowToast('CSV file is empty', 'error');
        return;
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));
      let gtinIdx = headers.findIndex((h) => h.includes('gtin') || h.includes('barcode') || h.includes('ean') || h.includes('upc'));
      let skuIdx = headers.findIndex((h) => h.includes('sku') || h.includes('code') || h.includes('item'));
      let nameIdx = headers.findIndex((h) => h.includes('product') || h.includes('name') || h.includes('title'));
      let shortIdx = headers.findIndex((h) => h.includes('short'));
      let imgIdx = headers.findIndex((h) => h.includes('image') || h.includes('photo') || h.includes('url'));
      let catIdx = headers.findIndex((h) => h.includes('category') || h.includes('dept'));

      if (gtinIdx === -1) gtinIdx = 0;
      if (skuIdx === -1) skuIdx = 1 < headers.length ? 1 : 0;
      if (nameIdx === -1) nameIdx = 2 < headers.length ? 2 : skuIdx;

      const parsedProducts: GtinCatalogProduct[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
        const gtin = cols[gtinIdx];
        if (!gtin) continue;

        const sku = skuIdx >= 0 && cols[skuIdx] ? cols[skuIdx] : gtin;
        const name = nameIdx >= 0 && cols[nameIdx] ? cols[nameIdx] : sku;
        const shortName = shortIdx >= 0 && cols[shortIdx] ? cols[shortIdx] : name;
        const img = imgIdx >= 0 && cols[imgIdx] ? cols[imgIdx] : '';
        const cat = catIdx >= 0 && cols[catIdx] ? cols[catIdx] : 'General';

        parsedProducts.push({
          gtin,
          sku,
          productName: name,
          shortName,
          imageUrl: img || undefined,
          category: cat,
        });
      }

      if (parsedProducts.length > 0) {
        for (const p of parsedProducts) {
          await addOrUpdateGtinProduct(p);
        }
        setGtinCatalog(getStoredGtinCatalog());
        onShowToast(`Imported ${parsedProducts.length} products from CSV!`, 'success');
      } else {
        onShowToast('Could not find any products in CSV', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Delete Manifest Row
  const handleDeleteManifest = (id: string, oId: string) => {
    if (window.confirm(`Are you sure you want to remove Order ${oId} from the pre-pack manifest?`)) {
      deleteManifest(oId);
      setManifests(getStoredManifests());
      onShowToast(`Order ${oId} removed from manifest`, 'info');
    }
  };

  // Filtered Manifests List
  const filteredManifests = useMemo(() => {
    return manifests.filter((m) => {
      const matchSearch =
        !searchQuery.trim() ||
        m.orderId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.assignedPackerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.items.some(
          (it) =>
            it.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
            it.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            it.gtin.toLowerCase().includes(searchQuery.toLowerCase())
        );

      const matchPacker = packerFilter === 'ALL' || m.assignedPackerEmail === packerFilter;
      const matchStatus = statusFilter === 'ALL' || m.status === statusFilter;
      const matchPlatform = platformFilter === 'ALL' || m.platform === platformFilter;

      return matchSearch && matchPacker && matchStatus && matchPlatform;
    });
  }, [manifests, searchQuery, packerFilter, statusFilter, platformFilter]);

  // Statistics Summary
  const stats = useMemo(() => {
    const total = manifests.length;
    const pending = manifests.filter((m) => m.status === 'Pending').length;
    const packed = manifests.filter((m) => m.status === 'Packed').length;
    const totalItems = manifests.reduce(
      (acc, m) => acc + m.items.reduce((s, it) => s + it.quantity, 0),
      0
    );
    return { total, pending, packed, totalItems };
  }, [manifests]);

  return (
    <div className="flex-1 bg-slate-50 min-h-screen p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Order Processing &amp; Pre-Pack Manifest
              </h1>
              <p className="text-xs text-slate-500">
                Pre-enter order items, assign to packers, and verify physical GTIN barcodes before video packing.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Top Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Sync GTIN Google Sheet</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddProductModalOpen(true)}
            className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <Plus className="w-4 h-4 text-indigo-600" />
            <span>Add GTIN Product</span>
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1">
            Total Manifest Orders
          </div>
          <div className="text-2xl font-black text-slate-900">{stats.total}</div>
        </div>

        <div className="bg-white border border-amber-200/80 rounded-2xl p-4 shadow-2xs bg-gradient-to-br from-white to-amber-50/30">
          <div className="text-[11px] font-mono uppercase tracking-wider text-amber-600 font-bold mb-1">
            Pending Packing
          </div>
          <div className="text-2xl font-black text-amber-600">{stats.pending}</div>
        </div>

        <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 shadow-2xs bg-gradient-to-br from-white to-emerald-50/30">
          <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-600 font-bold mb-1">
            Packed &amp; Verified
          </div>
          <div className="text-2xl font-black text-emerald-600">{stats.packed}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1">
            GTIN Catalog Size
          </div>
          <div className="text-2xl font-black text-indigo-600">{gtinCatalog.length} Items</div>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto select-none">
        <button
          type="button"
          onClick={() => setActiveSubTab('entry')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeSubTab === 'entry'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          <PackagePlus className="w-4 h-4" />
          <span>New Order Entry &amp; Assign</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('manifest')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeSubTab === 'manifest'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Manifest Queue ({manifests.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('gtin')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeSubTab === 'gtin'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          <Barcode className="w-4 h-4" />
          <span>GTIN Barcode Catalog ({gtinCatalog.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('audit')}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition flex items-center gap-2 cursor-pointer shrink-0 ${
            activeSubTab === 'audit'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Pack Verification Audit Logs ({verificationLogs.length})</span>
        </button>
      </div>

      {/* SUB-TAB 1: ORDER ENTRY FORM */}
      {activeSubTab === 'entry' && (
        <form onSubmit={handleSaveOrder} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Enter Order &amp; Product Details</span>
                <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-200">
                  Pre-Pack Step
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Packers will only be allowed to pack orders assigned to their account, and must scan each item's GTIN.
              </p>
            </div>

            {/* Who Processed This Badge (Auto-fetched from logged-in user account) */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2 text-right">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-bold">
                Processed By (Your Account)
              </span>
              <span className="text-xs font-bold text-slate-800 flex items-center justify-end gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{currentUser?.name || 'Administrator'}</span>
                <span className="text-slate-400 font-mono text-[11px]">({currentUser?.email || 'admin'})</span>
              </span>
            </div>
          </div>

          {/* Core Order Metadata: Order ID, Platform, Assigned Packer */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Order ID */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Order ID / AWB Number <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value.toUpperCase())}
                  placeholder="e.g. 402-1234567-8901234"
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-900 uppercase focus:bg-white focus:outline-none focus:border-indigo-500 transition shadow-inner"
                />
                <Barcode className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Platform */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                E-Commerce Platform <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['Amazon', 'D2C', 'JioMart', 'Custom'] as PlatformType[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={`py-2 text-xs font-bold rounded-xl border transition cursor-pointer text-center ${
                      platform === p
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {platform === 'Custom' && (
                <input
                  type="text"
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value)}
                  placeholder="Type Custom Platform Name..."
                  className="mt-2 w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              )}
            </div>

            {/* Assigned Packer Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Assign to Packer / Operator <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  required
                  value={assignedPackerEmail}
                  onChange={(e) => setAssignedPackerEmail(e.target.value)}
                  className="w-full pl-3.5 pr-8 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500 cursor-pointer shadow-inner"
                >
                  <option value="">-- Choose Assigned Packer --</option>
                  {registeredUsers.map((u) => (
                    <option key={u.email} value={u.email}>
                      {u.name} ({u.email}) - {u.role}
                    </option>
                  ))}
                  {/* Fallback to current user if no other users registered */}
                  {currentUser && (
                    <option value={currentUser.email}>
                      {currentUser.name} (Myself / Current User)
                    </option>
                  )}
                </select>
                <UserCheck className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Packer will see this in their queue and physically verify each GTIN.
              </span>
            </div>
          </div>

          {/* Product Items Table in Order */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  Products in This Order (Multi-Item Supported)
                </label>
                <span className="text-[11px] text-slate-400">
                  Product Name, SKU, and Barcode are all compulsory for packer scan verification.
                </span>
              </div>
              <button
                type="button"
                onClick={handleAddItemRow}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl border border-indigo-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-600" />
                <span>Add Another Product</span>
              </button>
            </div>

            {/* Smart 1-Step Auto-Fill Helper Banner */}
            <div className="bg-gradient-to-r from-indigo-50/90 via-purple-50/70 to-slate-50 border border-indigo-200/90 rounded-2xl p-3 text-xs text-indigo-950 flex items-start gap-2.5 shadow-2xs">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-indigo-900 block">
                  Smart 1-Field Auto-Fill: Enter ANY 1 detail (Product Name, SKU, or Barcode) — the system automatically fetches &amp; fills the other two!
                </span>
                <span className="text-[11px] text-slate-600 block">
                  All 3 details (Product Name, SKU, and Barcode) are compulsory so the packing operator can verify the physical item and scan its exact barcode.
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {orderItems.map((item, index) => (
                <div
                  key={item.tempId}
                  className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 relative hover:border-slate-300 transition"
                >
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                    <span className="text-xs font-mono font-bold text-slate-600 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                        {index + 1}
                      </span>
                      <span>Item #{index + 1}</span>
                    </span>

                    {orderItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItemRow(index)}
                        className="text-xs text-red-500 hover:text-red-700 font-bold flex items-center gap-1 cursor-pointer"
                        title="Remove item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                    {/* Image Thumbnail */}
                    <div className="sm:col-span-2 flex flex-col items-center justify-center">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt="Product"
                          className="w-16 h-16 rounded-xl object-contain bg-white border border-slate-200 p-1 shadow-xs"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-slate-200 text-slate-400 flex flex-col items-center justify-center text-[10px] text-center p-1 border border-slate-300">
                          <ShoppingBag className="w-5 h-5 mb-0.5" />
                          <span>No Image</span>
                        </div>
                      )}
                    </div>

                    {/* Product Name / Short Name (Auto-Fills GTIN & SKU) */}
                    <div className="sm:col-span-4 relative">
                      <label className="block text-[11px] font-bold text-slate-700 mb-0.5 flex items-center justify-between">
                        <span>
                          Product Name <span className="text-red-500">*</span>
                        </span>
                        <span className="text-[10px] text-indigo-600 font-medium">Auto-fills SKU &amp; GTIN</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          value={item.productName}
                          onFocus={() => setActiveSuggestion({ rowIndex: index, field: 'productName' })}
                          onBlur={() => handleFieldBlur(index, 'productName')}
                          onChange={(e) => {
                            handleItemFieldChange(index, 'productName', e.target.value);
                            setActiveSuggestion({ rowIndex: index, field: 'productName' });
                          }}
                          placeholder="Type product name (e.g. Navy Oxford)..."
                          className="w-full pl-8 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-indigo-500 shadow-inner"
                        />
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      {/* Dropdown Suggestions for Product Name */}
                      {activeSuggestion?.rowIndex === index && activeSuggestion?.field === 'productName' && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-indigo-200 rounded-xl shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-slate-100 animate-fade-in">
                          <div className="px-3 py-1 bg-indigo-50 text-[10px] font-mono text-indigo-700 font-bold sticky top-0 flex items-center justify-between">
                            <span>Catalog Suggestions</span>
                            <span>Click to Auto-Fill All</span>
                          </div>
                          {(searchCatalog(item.productName || '', 6).length > 0
                            ? searchCatalog(item.productName || '', 6)
                            : gtinCatalog.slice(0, 5)
                          ).map((catItem) => (
                            <div
                              key={catItem.gtin || catItem.sku}
                              onMouseDown={() => handleSelectProductFromCatalog(index, catItem)}
                              className="px-3 py-2 hover:bg-indigo-50/70 flex items-center gap-2.5 transition cursor-pointer"
                            >
                              {catItem.imageUrl ? (
                                <img src={catItem.imageUrl} alt="" className="w-7 h-7 rounded-lg object-contain bg-slate-50 border border-slate-200 p-0.5 shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                                  <ShoppingBag className="w-3.5 h-3.5" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-slate-900 truncate">
                                  {catItem.shortName || catItem.productName}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                                  <span>SKU: {catItem.sku || 'N/A'}</span>
                                  <span>•</span>
                                  <span>GTIN: {catItem.gtin || 'None'}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* SKU / Item Code */}
                    <div className="sm:col-span-3 relative">
                      <label className="block text-[11px] font-bold text-slate-700 mb-0.5 flex items-center justify-between">
                        <span>
                          SKU / Item Code <span className="text-red-500">*</span>
                        </span>
                        <span className="text-[10px] text-indigo-600 font-medium">Auto-fills</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={item.sku}
                        onFocus={() => setActiveSuggestion({ rowIndex: index, field: 'sku' })}
                        onBlur={() => handleFieldBlur(index, 'sku')}
                        onChange={(e) => {
                          handleItemFieldChange(index, 'sku', e.target.value);
                          setActiveSuggestion({ rowIndex: index, field: 'sku' });
                        }}
                        placeholder="e.g. SKU-SHIRT-BLUE"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 uppercase shadow-inner"
                      />

                      {/* Dropdown Suggestions for SKU */}
                      {activeSuggestion?.rowIndex === index && activeSuggestion?.field === 'sku' && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-indigo-200 rounded-xl shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-slate-100 animate-fade-in">
                          <div className="px-3 py-1 bg-indigo-50 text-[10px] font-mono text-indigo-700 font-bold sticky top-0 flex items-center justify-between">
                            <span>Catalog SKUs</span>
                            <span>Click to Auto-Fill</span>
                          </div>
                          {(searchCatalog(item.sku || '', 6).length > 0
                            ? searchCatalog(item.sku || '', 6)
                            : gtinCatalog.slice(0, 5)
                          ).map((catItem) => (
                            <div
                              key={catItem.sku || catItem.gtin}
                              onMouseDown={() => handleSelectProductFromCatalog(index, catItem)}
                              className="px-3 py-2 hover:bg-indigo-50/70 flex items-center gap-2 transition cursor-pointer"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-indigo-700 font-mono truncate">{catItem.sku}</div>
                                <div className="text-[10px] text-slate-500 truncate">{catItem.shortName || catItem.productName}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* GTIN Barcode / EAN (Compulsory for Packer Verification) */}
                    <div className="sm:col-span-3 relative">
                      <label className="block text-[11px] font-bold text-slate-700 mb-0.5 flex items-center justify-between">
                        <span>
                          GTIN / Barcode <span className="text-red-500">*</span>
                        </span>
                        <span className="text-[10px] text-indigo-600 font-medium">Auto-fills</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          value={item.gtin}
                          onFocus={() => setActiveSuggestion({ rowIndex: index, field: 'gtin' })}
                          onBlur={() => handleFieldBlur(index, 'gtin')}
                          onChange={(e) => {
                            handleItemFieldChange(index, 'gtin', e.target.value);
                            setActiveSuggestion({ rowIndex: index, field: 'gtin' });
                          }}
                          placeholder="Scan or type barcode..."
                          className="w-full pl-8 pr-14 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-indigo-500 shadow-inner"
                        />
                        <Barcode className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <button
                          type="button"
                          onClick={() => handleAutoAssignBarcode(index)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[9px] font-mono font-bold rounded-md border border-indigo-200 transition cursor-pointer"
                          title="Generate a 13-digit GTIN barcode for custom/new products"
                        >
                          + Auto
                        </button>
                      </div>

                      {/* Dropdown Suggestions for GTIN */}
                      {activeSuggestion?.rowIndex === index && activeSuggestion?.field === 'gtin' && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-indigo-200 rounded-xl shadow-xl z-30 max-h-52 overflow-y-auto divide-y divide-slate-100 animate-fade-in">
                          <div className="px-3 py-1 bg-indigo-50 text-[10px] font-mono text-indigo-700 font-bold sticky top-0 flex items-center justify-between">
                            <span>Catalog Barcodes</span>
                            <span>Click to Auto-Fill</span>
                          </div>
                          {(searchCatalog(item.gtin || '', 6).length > 0
                            ? searchCatalog(item.gtin || '', 6)
                            : gtinCatalog.slice(0, 5)
                          ).map((catItem) => (
                            <div
                              key={catItem.gtin || catItem.sku}
                              onMouseDown={() => handleSelectProductFromCatalog(index, catItem)}
                              className="px-3 py-2 hover:bg-indigo-50/70 flex items-center gap-2 transition cursor-pointer"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-slate-900 font-mono truncate">{catItem.gtin}</div>
                                <div className="text-[10px] text-slate-500 truncate">{catItem.shortName || catItem.productName}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quantity and Secondary Line Details */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {/* Required Quantity Stepper */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-slate-700">
                        Required Quantity:
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleItemFieldChange(index, 'quantity', Math.max(1, item.quantity - 1))
                          }
                          className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 flex items-center justify-center cursor-pointer shadow-2xs"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="1"
                          required
                          value={item.quantity}
                          onChange={(e) =>
                            handleItemFieldChange(index, 'quantity', Math.max(1, parseInt(e.target.value) || 1))
                          }
                          className="w-12 text-center py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-black text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => handleItemFieldChange(index, 'quantity', item.quantity + 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 flex items-center justify-center cursor-pointer shadow-2xs"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Catalog Match Bar */}
                  {gtinCatalog.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/60 flex items-center gap-2 overflow-x-auto">
                      <span className="text-[10px] font-mono text-slate-400 shrink-0 font-bold">
                        Quick Pick from Catalog:
                      </span>
                      {gtinCatalog.slice(0, 6).map((catItem) => (
                        <button
                          key={catItem.gtin}
                          type="button"
                          onClick={() => handleSelectProductFromCatalog(index, catItem)}
                          className="px-2 py-0.5 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-[11px] font-medium text-slate-700 rounded-lg border border-slate-200 transition shrink-0 flex items-center gap-1 cursor-pointer"
                        >
                          <span>{catItem.shortName || catItem.productName}</span>
                          <span className="text-[9px] font-mono text-slate-400">({catItem.sku})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Packing Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Packing Instructions / Special Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Fragile glass item • Double bubble wrap • Include invoice leaflet"
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Submit Action Button */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="submit"
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-600/20 transition flex items-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save &amp; Assign Order to Packer</span>
            </button>
          </div>
        </form>
      )}

      {/* SUB-TAB 2: MANIFEST QUEUE TABLE */}
      {activeSubTab === 'manifest' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Manifest Order Queue</span>
                <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                  {filteredManifests.length} Orders
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                All pre-entered orders waiting for physical GTIN scan and video packing.
              </p>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Order ID, SKU, Packer..."
                className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-bold">
              <Filter className="w-3.5 h-3.5" />
              <span>Filter:</span>
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Packed">Packed</option>
            </select>

            {/* Packer Filter */}
            <select
              value={packerFilter}
              onChange={(e) => setPackerFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="ALL">All Packers</option>
              {registeredUsers.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name}
                </option>
              ))}
            </select>

            {/* Platform Filter */}
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 cursor-pointer"
            >
              <option value="ALL">All Platforms</option>
              <option value="Amazon">Amazon</option>
              <option value="D2C">D2C</option>
              <option value="JioMart">JioMart</option>
              <option value="Custom">Custom</option>
            </select>
          </div>

          {/* Manifest Items List */}
          {filteredManifests.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2 border-2 border-dashed border-slate-200 rounded-2xl">
              <Boxes className="w-10 h-10 mx-auto text-slate-300" />
              <div className="font-bold text-sm text-slate-600">No Orders in Manifest</div>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No orders match your filter criteria. Pre-enter a new order in the "New Order Entry" tab to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredManifests.map((m) => {
                const totalItemsCount = m.items.reduce((s, it) => s + it.quantity, 0);
                const isPacked = m.status === 'Packed';

                return (
                  <div
                    key={m.id || m.orderId}
                    className={`border rounded-2xl p-4 transition ${
                      isPacked
                        ? 'bg-emerald-50/30 border-emerald-200'
                        : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-base font-mono font-black text-slate-900 tracking-wide">
                          {m.orderId}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          {m.platform}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            isPacked
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}
                        >
                          {m.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteManifest(m.id, m.orderId)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition cursor-pointer"
                          title="Delete from manifest"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Metadata & Assignment Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[10px] font-mono uppercase font-bold">
                          Assigned Packer
                        </span>
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                          <span>{m.assignedPackerName}</span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            ({m.assignedPackerEmail})
                          </span>
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] font-mono uppercase font-bold">
                          Processed By
                        </span>
                        <span className="font-bold text-slate-700">
                          {m.processedByName}
                          <span className="text-[11px] text-slate-400 font-normal ml-1">
                            • {new Date(m.processedAt).toLocaleTimeString()}
                          </span>
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[10px] font-mono uppercase font-bold">
                          Total Items to Pack
                        </span>
                        <span className="font-black text-slate-900">
                          {totalItemsCount} {totalItemsCount === 1 ? 'Product' : 'Products'} ({m.items.length} SKUs)
                        </span>
                      </div>
                    </div>

                    {/* Items Thumbnails & List */}
                    <div className="mt-2 pt-2 border-t border-slate-100 bg-slate-50/70 rounded-xl p-2.5 space-y-1.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block font-bold">
                        Required Products to Verify:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {m.items.map((it) => (
                          <div
                            key={it.id || it.sku}
                            className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl p-2 shadow-2xs"
                          >
                            {it.imageUrl ? (
                              <img
                                src={it.imageUrl}
                                alt="Item"
                                className="w-9 h-9 rounded-lg object-contain bg-slate-50 border border-slate-100 p-0.5 shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                                <ShoppingBag className="w-4 h-4" />
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-slate-900 truncate">
                                {it.shortName || it.productName}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400 truncate">
                                GTIN: {it.gtin} • SKU: {it.sku}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg">
                                Qty: {it.quantity}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {m.notes && (
                      <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                        <span className="font-bold">Note: </span>
                        {m.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: GTIN BARCODE CATALOG */}
      {activeSubTab === 'gtin' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Product GTIN &amp; Barcode Catalog</span>
                <span className="text-xs font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-200">
                  {gtinCatalog.length} Products
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Master database of your products, barcodes (EAN/GTIN/UPC), SKUs, and thumbnails for pack verification.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-2xs">
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>Upload CSV</span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleCsvUpload}
                />
              </label>

              <button
                type="button"
                onClick={handleDownloadCsvTemplate}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Download Sample CSV Template"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
                <span>Template</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSyncModalOpen(true)}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Sync Google Sheet</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAddProductModalOpen(true)}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Product</span>
              </button>
            </div>
          </div>

          {/* Product Catalog Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {gtinCatalog.map((prod) => (
              <div
                key={prod.gtin}
                className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-2xl p-3.5 space-y-2.5 transition shadow-2xs flex flex-col justify-between"
              >
                <div className="flex items-start gap-3">
                  {prod.imageUrl ? (
                    <img
                      src={prod.imageUrl}
                      alt={prod.shortName}
                      className="w-14 h-14 rounded-xl object-contain bg-white border border-slate-200 p-1 shadow-xs shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                      <ShoppingBag className="w-6 h-6" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-mono text-indigo-600 uppercase font-bold block">
                      {prod.category || 'General'}
                    </span>
                    <h3 className="text-xs font-bold text-slate-900 truncate" title={prod.productName}>
                      {prod.shortName || prod.productName}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500 font-bold mt-0.5">
                      SKU: {prod.sku}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-mono font-black text-slate-900">{prod.gtin}</span>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 font-bold">
                    Active
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: PACK VERIFICATION AUDIT LOGS */}
      {activeSubTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Pack Verification Audit Logs</span>
              <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {verificationLogs.length} Events
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Live audit trail of scanned GTIN barcodes vs expected manifest values, recording verified packers, timestamps, and video links.
            </p>
          </div>

          {verificationLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2 border-2 border-dashed border-slate-200 rounded-2xl">
              <ShieldCheck className="w-10 h-10 mx-auto text-slate-300" />
              <div className="font-bold text-sm text-slate-600">No Verification Logs Yet</div>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Audit logs are automatically created every time a packer verifies an order's physical GTIN barcodes.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 font-mono text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Time</th>
                    <th className="p-3">Order ID</th>
                    <th className="p-3">Assigned Packer</th>
                    <th className="p-3">Verified By</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Scanned / Required</th>
                    <th className="p-3">Scanned GTINs</th>
                    <th className="p-3">Video Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {verificationLogs.map((log, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="p-3 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {log.orderId}
                      </td>
                      <td className="p-3 text-slate-700 whitespace-nowrap">{log.assignedPacker}</td>
                      <td className="p-3 text-slate-700 whitespace-nowrap font-medium">
                        {log.verifiedByPacker}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            log.status === 'MATCHED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                        {log.totalScanned} / {log.totalRequired}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-600 max-w-xs truncate">
                        {Array.isArray(log.scannedGtinsLog) ? log.scannedGtinsLog.join(', ') : ''}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {log.videoDriveUrl ? (
                          <a
                            href={log.videoDriveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 font-medium"
                          >
                            <span>View Video</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-slate-400">Recording</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: SYNC SEPARATE GOOGLE SHEET */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">
                  Connect Separate GTIN Google Sheet
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Provide the Google Sheet link or ID containing your products and GTIN barcodes. The system will automatically detect the columns (<code className="font-mono text-indigo-600">GTIN</code>, <code className="font-mono text-indigo-600">SKU</code>, <code className="font-mono text-indigo-600">Product Name</code>, <code className="font-mono text-indigo-600">Short Name</code>, <code className="font-mono text-indigo-600">Image URL</code>).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Google Sheet URL or Spreadsheet ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={gtinSheetInput}
                  onChange={(e) => setGtinSheetInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit or ID"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Sheet Tab Name (Optional, defaults to first tab)
                </label>
                <input
                  type="text"
                  value={gtinSheetTab}
                  onChange={(e) => setGtinSheetTab(e.target.value)}
                  placeholder="e.g. Sheet1, Products, or GTINs"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {sheetSyncResult && (
              <div
                className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                  sheetSyncResult.success
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {sheetSyncResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                <span>{sheetSyncResult.msg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isSyncingSheet || !gtinSheetInput.trim()}
                onClick={handlePerformGtinSync}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSyncingSheet ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Syncing Sheet...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Sync Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD PRODUCT TO CATALOG */}
      {isAddProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <form
            onSubmit={handleAddNewProduct}
            className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Barcode className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">Add Product to GTIN Catalog</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddProductModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  GTIN / Barcode (EAN, UPC, Code 128) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newGtin}
                  onChange={(e) => setNewGtin(e.target.value.trim())}
                  placeholder="e.g. 8901234567890"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Product SKU / Item Code
                </label>
                <input
                  type="text"
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="e.g. SKU-SHIRT-NAVY-L"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Product Name
                </label>
                <input
                  type="text"
                  value={newProdName}
                  onChange={(e) => setNewProdName(e.target.value)}
                  placeholder="e.g. Premium Cotton Oxford Shirt - Navy Blue (Size L)"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Short Name (Displayed on packing screen)
                </label>
                <input
                  type="text"
                  value={newShortName}
                  onChange={(e) => setNewShortName(e.target.value)}
                  placeholder="e.g. Navy Oxford Shirt (L)"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Product Image URL (Optional)
                </label>
                <input
                  type="url"
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="https://... image link"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddProductModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
              >
                Save Product
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
