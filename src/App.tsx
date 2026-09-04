import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { StoreProvider } from '@/store/StoreContext';
import { StorefrontLayout } from '@/layouts/StorefrontLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const ShopPage = lazy(() => import('@/pages/ShopPage').then((m) => ({ default: m.ShopPage })));
const CategoryPage = lazy(() => import('@/pages/CategoryPage').then((m) => ({ default: m.CategoryPage })));
const ProductDetailsPage = lazy(() => import('@/pages/ProductDetailsPage').then((m) => ({ default: m.ProductDetailsPage })));
const SearchResultsPage = lazy(() => import('@/pages/SearchResultsPage').then((m) => ({ default: m.SearchResultsPage })));
const WishlistPage = lazy(() => import('@/pages/WishlistPage').then((m) => ({ default: m.WishlistPage })));
const CartPage = lazy(() => import('@/pages/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const OrderConfirmationPage = lazy(() => import('@/pages/OrderConfirmationPage').then((m) => ({ default: m.OrderConfirmationPage })));
const AuthPage = lazy(() => import('@/pages/AuthPage').then((m) => ({ default: m.AuthPage })));
const AccountPage = lazy(() => import('@/pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminProductsPage = lazy(() => import('@/pages/admin/AdminProductsPage').then((m) => ({ default: m.AdminProductsPage })));
const AdminProductEditPage = lazy(() => import('@/pages/admin/AdminProductEditPage').then((m) => ({ default: m.AdminProductEditPage })));
const AdminInventoryPage = lazy(() => import('@/pages/admin/AdminInventoryPage').then((m) => ({ default: m.AdminInventoryPage })));
const AdminOrdersPage = lazy(() => import('@/pages/admin/AdminOrdersPage').then((m) => ({ default: m.AdminOrdersPage })));
const AdminCustomersPage = lazy(() => import('@/pages/admin/AdminCustomersPage').then((m) => ({ default: m.AdminCustomersPage })));
const AdminCategoriesPage = lazy(() => import('@/pages/admin/AdminCategoriesPage').then((m) => ({ default: m.AdminCategoriesPage })));
const AdminCouponsPage = lazy(() => import('@/pages/admin/AdminCouponsPage').then((m) => ({ default: m.AdminCouponsPage })));
const AdminReviewsPage = lazy(() => import('@/pages/admin/AdminReviewsPage').then((m) => ({ default: m.AdminReviewsPage })));
const AdminAnalyticsPage = lazy(() => import('@/pages/admin/AdminAnalyticsPage').then((m) => ({ default: m.AdminAnalyticsPage })));
const AdminContentPage = lazy(() => import('@/pages/admin/AdminContentPage').then((m) => ({ default: m.AdminContentPage })));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })));
const PrivacyPolicyPage = lazy(() => import('@/pages/legal/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage = lazy(() => import('@/pages/legal/TermsPage').then((m) => ({ default: m.TermsPage })));
const ShippingPolicyPage = lazy(() => import('@/pages/legal/ShippingPolicyPage').then((m) => ({ default: m.ShippingPolicyPage })));
const RefundPolicyPage = lazy(() => import('@/pages/legal/RefundPolicyPage').then((m) => ({ default: m.RefundPolicyPage })));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return null;
}

function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Suspense fallback={<div className="grid min-h-[40vh] place-items-center" />}> <Routes>
          {/* Storefront */}
          <Route element={<StorefrontLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/new-arrivals" element={<ShopPage title="New Arrivals" />} />
            <Route path="/offers" element={<ShopPage title="Offers & Sale" />} />
            <Route path="/category/:slug" element={<CategoryPage />} />
            <Route path="/product/:id" element={<ProductDetailsPage />} />
            <Route path="/search" element={<SearchResultsPage />} />
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/order-confirmation/:orderNumber" element={<OrderConfirmationPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/orders" element={<AccountPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
            <Route path="/refund-policy" element={<RefundPolicyPage />} />
          </Route>

          {/* Auth */}
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="products" element={<AdminProductsPage />} />
            <Route path="products/new" element={<AdminProductEditPage />} />
            <Route path="products/:id/edit" element={<AdminProductEditPage />} />
            <Route path="inventory" element={<AdminInventoryPage />} />
            <Route path="orders" element={<AdminOrdersPage />} />
            <Route path="customers" element={<AdminCustomersPage />} />
            <Route path="categories" element={<AdminCategoriesPage />} />
            <Route path="coupons" element={<AdminCouponsPage />} />
            <Route path="reviews" element={<AdminReviewsPage />} />
            <Route path="analytics" element={<AdminAnalyticsPage />} />
            <Route path="content" element={<AdminContentPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>
        </Routes></Suspense>
      </BrowserRouter>
    </StoreProvider>
  );
}

export default App;
