import { Search, X } from 'lucide-react';

export default function SearchBar({ value, onChange, placeholder = 'ابحث عن متجر أو منتج...', label = 'بحث' }) {
  return (
    <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
      <Search size={20} aria-hidden="true"/>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        type="search"
        enterKeyHint="search"
      />
      {value ? (
        <button type="button" className="searchbar-clear" onClick={() => onChange('')} aria-label="مسح البحث">
          <X size={15}/>
        </button>
      ) : null}
    </form>
  );
}
